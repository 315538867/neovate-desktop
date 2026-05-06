/**
 * Wave 3.2 commit 2.4 — Observability + error classification tests.
 *
 * Covers TraceEmitter (seq assignment, persistence, fan-out, history
 * filter, recovery from prior seq); analytics derivations
 * (computeRunMetrics / stageDurations / topSlowStages); the dashboard
 * report builder; the error classifier ladder; ErrorStore counting;
 * and RetryPolicy decisions for L0-L4.
 */

import type Store from "electron-store";

import { describe, expect, it, vi } from "vitest";

import type { Run, TraceEvent } from "../../../../shared/features/agent-orchestrator/types";
import type { IStorageService } from "../../../core/storage-service";

import { classifyError } from "../errors/error-classifier";
import { ErrorStore } from "../errors/error-store";
import { RetryPolicy } from "../errors/retry-policy";
import { computeRunMetrics, stageDurations, topSlowStages } from "../observability/analytics";
import { buildRunReport } from "../observability/dashboard";
import { TraceEmitter } from "../observability/trace";
import { EventStore } from "../persistence/event-store";

// ── In-memory storage fake (mirrors checkpoint.test.ts) ────────────

class FakeStore {
  private data = new Map<string, unknown>();

  set(arg1: string | Record<string, unknown>, value?: unknown): void {
    if (typeof arg1 === "string") {
      this.data.set(arg1, value);
      return;
    }
    for (const [k, v] of Object.entries(arg1)) this.data.set(k, v);
  }

  get(key: string): unknown {
    return this.data.get(key);
  }

  has(key: string): boolean {
    return this.data.has(key);
  }

  delete(key: string): void {
    this.data.delete(key);
  }

  clear(): void {
    this.data.clear();
  }

  get store(): Record<string, unknown> {
    return Object.fromEntries(this.data);
  }
}

class FakeStorage implements IStorageService {
  private readonly stores = new Map<string, FakeStore>();

  scoped(namespace: string): Store {
    let s = this.stores.get(namespace);
    if (!s) {
      s = new FakeStore();
      this.stores.set(namespace, s);
    }
    return s as unknown as Store;
  }

  dispose(): void {
    this.stores.clear();
  }
}

// ── Test fixtures ──────────────────────────────────────────────────

function eventLog(runId = "r1"): TraceEvent[] {
  return [
    { type: "run.start", seq: 1, runId, timestamp: 100, templateId: "tpl" },
    { type: "stage.start", seq: 2, runId, timestamp: 110, stageId: "a", branchIndex: 0 },
    {
      type: "stage.end",
      seq: 3,
      runId,
      timestamp: 200,
      stageId: "a",
      branchIndex: 0,
      status: "succeeded",
      durationMs: 90,
    },
    { type: "stage.start", seq: 4, runId, timestamp: 210, stageId: "b", branchIndex: 0 },
    {
      type: "stage.error",
      seq: 5,
      runId,
      timestamp: 220,
      stageId: "b",
      branchIndex: 0,
      level: "L2",
      message: "boom",
    },
    {
      type: "stage.end",
      seq: 6,
      runId,
      timestamp: 260,
      stageId: "b",
      branchIndex: 0,
      status: "failed",
      durationMs: 50,
    },
    { type: "fanout.expanded", seq: 7, runId, timestamp: 270, stageId: "c", branches: 3 },
    { type: "gate.requested", seq: 8, runId, timestamp: 280, stageId: "d" },
    { type: "gate.resolved", seq: 9, runId, timestamp: 290, stageId: "d", approved: true },
    {
      type: "budget.exceeded",
      seq: 10,
      runId,
      timestamp: 295,
      dimension: "tokens",
      usage: { usedTokens: 100, usedDurationMs: 0, usedCostUsd: 0, completedStages: 1 },
    },
    { type: "run.end", seq: 11, runId, timestamp: 300, status: "completed" },
  ];
}

// ── TraceEmitter ───────────────────────────────────────────────────

describe("TraceEmitter", () => {
  it("assigns monotonic seq + persists to EventStore", () => {
    const storage = new FakeStorage();
    const eventStore = new EventStore(storage);
    let now = 1000;
    const emitter = new TraceEmitter({
      eventStore,
      clock: () => ++now,
    });
    const a = emitter.emit({
      type: "run.start",
      runId: "r1",
      timestamp: 0,
      templateId: "t",
    });
    const b = emitter.emit({
      type: "stage.start",
      runId: "r1",
      timestamp: 0,
      stageId: "x",
      branchIndex: 0,
    });
    const c = emitter.emit({
      type: "stage.start",
      runId: "r2",
      timestamp: 0,
      stageId: "x",
      branchIndex: 0,
    });
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(c.seq).toBe(1);
    expect(eventStore.list("r1")).toHaveLength(2);
    expect(eventStore.list("r2")).toHaveLength(1);
  });

  it("recovers seq from existing EventStore on first emit", () => {
    const storage = new FakeStorage();
    const eventStore = new EventStore(storage);
    eventStore.append("r1", {
      type: "run.start",
      seq: 5,
      runId: "r1",
      timestamp: 0,
      templateId: "t",
    });
    const emitter = new TraceEmitter({ eventStore });
    const e = emitter.emit({
      type: "stage.start",
      runId: "r1",
      timestamp: 0,
      stageId: "x",
      branchIndex: 0,
    });
    expect(e.seq).toBe(6);
  });

  it("subscribeRun streams events for that run only", async () => {
    const storage = new FakeStorage();
    const eventStore = new EventStore(storage);
    const emitter = new TraceEmitter({ eventStore });
    const stream = emitter.subscribeRun("r1");
    const collected: TraceEvent[] = [];
    const consumer = (async () => {
      for await (const ev of stream) {
        collected.push(ev);
        if (collected.length === 2) break;
      }
    })();
    emitter.emit({ type: "run.start", runId: "r1", timestamp: 0, templateId: "t" });
    emitter.emit({ type: "run.start", runId: "r2", timestamp: 0, templateId: "t" });
    emitter.emit({
      type: "run.end",
      runId: "r1",
      timestamp: 0,
      status: "completed",
    });
    await consumer;
    expect(collected.map((e) => e.runId)).toEqual(["r1", "r1"]);
  });

  it("subscribeAll receives every emit", async () => {
    const storage = new FakeStorage();
    const eventStore = new EventStore(storage);
    const emitter = new TraceEmitter({ eventStore });
    const stream = emitter.subscribeAll();
    const collected: string[] = [];
    const consumer = (async () => {
      for await (const ev of stream) {
        collected.push(ev.runId);
        if (collected.length === 3) break;
      }
    })();
    emitter.emit({ type: "run.start", runId: "r1", timestamp: 0, templateId: "t" });
    emitter.emit({ type: "run.start", runId: "r2", timestamp: 0, templateId: "t" });
    emitter.emit({
      type: "run.end",
      runId: "r1",
      timestamp: 0,
      status: "completed",
    });
    await consumer;
    expect(collected).toEqual(["r1", "r2", "r1"]);
  });

  it("history(types) filters by event type", () => {
    const storage = new FakeStorage();
    const eventStore = new EventStore(storage);
    eventStore.appendBatch("r1", eventLog("r1"));
    const emitter = new TraceEmitter({ eventStore });
    const errors = emitter.history("r1", ["stage.error"]);
    expect(errors).toHaveLength(1);
    const all = emitter.history("r1");
    expect(all).toHaveLength(11);
  });

  it("closeRun ends the per-run subscription", async () => {
    const storage = new FakeStorage();
    const eventStore = new EventStore(storage);
    const emitter = new TraceEmitter({ eventStore });
    const stream = emitter.subscribeRun("r1");
    let count = 0;
    const consumer = (async () => {
      for await (const _ev of stream) count++;
    })();
    emitter.emit({ type: "run.start", runId: "r1", timestamp: 0, templateId: "t" });
    emitter.closeRun("r1");
    await consumer;
    expect(count).toBe(1);
  });
});

// ── Analytics ──────────────────────────────────────────────────────

describe("computeRunMetrics", () => {
  it("derives counts and duration from a run", () => {
    const m = computeRunMetrics(eventLog());
    expect(m.startedAt).toBe(100);
    expect(m.endedAt).toBe(300);
    expect(m.durationMs).toBe(200);
    expect(m.stageStarts).toBe(2);
    expect(m.stageEnds).toBe(2);
    expect(m.errors).toBe(1);
    expect(m.gateRequests).toBe(1);
    expect(m.gateApprovals).toBe(1);
    expect(m.fanoutBranches).toBe(3);
    expect(m.budgetBreaches).toBe(1);
  });

  it("returns zeros for an empty log", () => {
    const m = computeRunMetrics([]);
    expect(m.startedAt).toBeUndefined();
    expect(m.durationMs).toBe(0);
    expect(m.stageStarts).toBe(0);
  });
});

describe("stageDurations + topSlowStages", () => {
  it("matches start/end pairs and computes duration", () => {
    const durations = stageDurations(eventLog());
    expect(durations).toEqual([
      { stageId: "a", branchIndex: 0, status: "succeeded", durationMs: 90 },
      { stageId: "b", branchIndex: 0, status: "failed", durationMs: 50 },
    ]);
  });

  it("topSlowStages ranks descending", () => {
    const top = topSlowStages(eventLog(), 1);
    expect(top).toEqual([{ stageId: "a", branchIndex: 0, status: "succeeded", durationMs: 90 }]);
  });

  it("falls back to event timestamps when durationMs is zero", () => {
    const events: TraceEvent[] = [
      { type: "stage.start", seq: 1, runId: "r", timestamp: 100, stageId: "x", branchIndex: 0 },
      {
        type: "stage.end",
        seq: 2,
        runId: "r",
        timestamp: 250,
        stageId: "x",
        branchIndex: 0,
        status: "succeeded",
        durationMs: 0,
      },
    ];
    expect(stageDurations(events)).toEqual([
      { stageId: "x", branchIndex: 0, status: "succeeded", durationMs: 150 },
    ]);
  });
});

// ── Dashboard ──────────────────────────────────────────────────────

describe("buildRunReport", () => {
  function makeRun(): Run {
    return {
      id: "r1",
      templateId: "tpl",
      templateVersion: "1.0.0",
      cwd: "/tmp",
      status: "completed",
      startedAt: 100,
      completedAt: 300,
      budgetUsage: {
        usedTokens: 100,
        usedDurationMs: 0,
        usedCostUsd: 0,
        completedStages: 1,
      },
      executions: [
        { stageId: "a", branchIndex: 0, status: "succeeded", startedAt: 110, completedAt: 200 },
        {
          stageId: "b",
          branchIndex: 0,
          status: "failed",
          startedAt: 210,
          completedAt: 260,
          error: { level: "L2", message: "boom" },
        },
      ],
    };
  }

  it("aggregates run + events into a report", () => {
    const report = buildRunReport(makeRun(), eventLog());
    expect(report.run.status).toBe("completed");
    expect(report.metrics.errors).toBe(1);
    expect(report.durations).toHaveLength(2);
    expect(report.slowest[0]?.stageId).toBe("a");
    expect(report.failedStages).toHaveLength(1);
    expect(report.failedStages[0]?.error?.level).toBe("L2");
  });
});

// ── Error classifier ───────────────────────────────────────────────

describe("classifyError", () => {
  it.each([
    [new Error("Rate limit exceeded"), "L0", "rate-limit"],
    [new Error("status 429 too many requests"), "L0", "rate-limit"],
    [new Error("ECONNRESET reading stream"), "L1", "network-transient"],
    [new Error("upstream returned 503"), "L1", "provider-5xx"],
    [Object.assign(new Error("timeout"), { name: "StageTimeoutError" }), "L2", "stage-timeout"],
    [new Error("heartbeat stale for stage x"), "L2", "heartbeat-stale"],
    [new Error("validation failed: schema mismatch"), "L3", "validation-failed"],
    [new Error("template not found"), "L4", "config-error"],
    [new Error("budget exceeded for tokens"), "L4", "budget-exceeded"],
    [new Error("totally unknown surprise"), "L3", "unknown"],
  ])("classifies %#", (err, expectedLevel, expectedCode) => {
    const c = classifyError(err);
    expect(c.level).toBe(expectedLevel);
    expect(c.code).toBe(expectedCode);
  });

  it("preserves original message + stack", () => {
    const c = classifyError(new Error("ECONNRESET deep down"));
    expect(c.message).toBe("ECONNRESET deep down");
    expect(c.cause).toContain("Error");
  });

  it("handles non-Error values gracefully", () => {
    const c = classifyError("rate-limit cap hit");
    expect(c.level).toBe("L0");
    expect(c.message).toBe("rate-limit cap hit");
    expect(c.cause).toBeUndefined();
  });
});

// ── ErrorStore ─────────────────────────────────────────────────────

describe("ErrorStore", () => {
  it("records and counts attempts", () => {
    const storage = new FakeStorage();
    let n = 0;
    const store = new ErrorStore({
      storage,
      clock: () => 1234,
      idFactory: () => `e-${++n}`,
    });
    store.record({
      runId: "r1",
      stageId: "a",
      branchIndex: 0,
      level: "L1",
      code: "provider-5xx",
      message: "boom",
      attempt: 1,
    });
    store.record({
      runId: "r1",
      stageId: "a",
      branchIndex: 0,
      level: "L1",
      code: "provider-5xx",
      message: "boom2",
      attempt: 2,
    });
    store.record({
      runId: "r1",
      stageId: "b",
      branchIndex: 0,
      level: "L0",
      code: "rate-limit",
      message: "slow",
      attempt: 1,
    });
    expect(store.list("r1")).toHaveLength(3);
    expect(store.countAttempts("r1", "a", 0)).toBe(2);
    expect(store.countAttempts("r1", "b", 0)).toBe(1);
    expect(store.countAttempts("r1", "missing", 0)).toBe(0);
    store.clear("r1");
    expect(store.list("r1")).toEqual([]);
  });
});

// ── RetryPolicy ────────────────────────────────────────────────────

describe("RetryPolicy", () => {
  const policy = new RetryPolicy({ random: () => 0 });

  it("returns shouldRetry=false for L3/L4", () => {
    const fatal = classifyError(new Error("validation failed"));
    expect(policy.decide({ error: fatal, attempt: 1 }).shouldRetry).toBe(false);
    const cfg = classifyError(new Error("template not found"));
    expect(policy.decide({ error: cfg, attempt: 1 }).shouldRetry).toBe(false);
  });

  it("returns shouldRetry=true for L0/L1/L2 below max attempts", () => {
    const rl = classifyError(new Error("rate limit"));
    expect(policy.decide({ error: rl, attempt: 1 }).shouldRetry).toBe(true);
    expect(policy.decide({ error: rl, attempt: 2 }).shouldRetry).toBe(true);
    expect(policy.decide({ error: rl, attempt: 3 }).shouldRetry).toBe(false);
  });

  it("doubles base delay each attempt", () => {
    const err = classifyError(new Error("upstream returned 503"));
    const a = policy.decide({ error: err, attempt: 1 }).delayMs;
    const b = policy.decide({ error: err, attempt: 2 }).delayMs;
    expect(a).toBe(1000);
    expect(b).toBe(2000);
  });

  it("bumps fallback when configured threshold is reached", () => {
    const err = classifyError(new Error("upstream returned 503"));
    expect(policy.decide({ error: err, attempt: 1 }).bumpFallback).toBe(false);
    expect(policy.decide({ error: err, attempt: 2 }).bumpFallback).toBe(true);
  });

  it("respects retryable=false", () => {
    const err = classifyError(new Error("budget exceeded"));
    expect(policy.decide({ error: err, attempt: 1 }).shouldRetry).toBe(false);
  });

  it("uses provided random for jitter", () => {
    const random = vi.fn().mockReturnValue(0.5);
    const p = new RetryPolicy({ random });
    const err = classifyError(new Error("rate limit"));
    const d = p.decide({ error: err, attempt: 1 });
    expect(random).toHaveBeenCalled();
    // base 250 + jitter (250 * 0.3 * 0.5 = 37.5) → rounded 288
    expect(d.delayMs).toBe(288);
  });
});
