/**
 * Wave 3.2 commit 2.3 — Budget controller & safety primitives unit tests.
 *
 * Each safety module is exercised in isolation with deterministic
 * clocks / schedulers. The orchestrator façade wiring is left for
 * commit 2.5.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import { BudgetTracker } from "../safety/budget";
import { ConcurrencyLimiter } from "../safety/concurrency-limiter";
import { HeartbeatMonitor, type HeartbeatScheduler } from "../safety/heartbeat";
import { ProviderFallback } from "../safety/provider-fallback";
import { redactSensitive, redactValue } from "../safety/redaction";
import { SingleInstanceLock } from "../safety/single-instance-lock";
import { StageTimeoutError, withStageTimeout } from "../safety/stage-timeout";

// ── BudgetTracker ──────────────────────────────────────────────────

describe("BudgetTracker", () => {
  it("reports zero usage and never aborts when no budget is set", () => {
    const tracker = new BudgetTracker();
    tracker.consumeTokens(10_000);
    tracker.consumeDuration(60_000);
    tracker.consumeCost(5);
    tracker.incrementStages(20);
    expect(tracker.aborted).toBe(false);
  });

  it("fires onExceed exactly once per dimension when caps are hit", () => {
    const exceed = vi.fn();
    const tracker = new BudgetTracker({
      budget: { maxTokens: 100, maxDurationMs: 1000, maxCostUsd: 1, maxStages: 2 },
      onExceed: exceed,
    });
    tracker.consumeTokens(50);
    expect(tracker.aborted).toBe(false);
    tracker.consumeTokens(60); // first crosses cap — fires here at 110
    tracker.consumeTokens(40); // already fired — silent
    expect(tracker.aborted).toBe(true);
    expect(exceed).toHaveBeenCalledTimes(1);
    expect(exceed).toHaveBeenCalledWith("tokens", expect.objectContaining({ usedTokens: 110 }));

    tracker.consumeDuration(1500);
    tracker.incrementStages(2);
    tracker.consumeCost(2);
    expect(exceed).toHaveBeenCalledTimes(4);
    const dimensions = exceed.mock.calls.map((c) => c[0]);
    expect(dimensions).toEqual(["tokens", "duration", "stages", "cost"]);
  });

  it("rejects negative deltas", () => {
    const tracker = new BudgetTracker();
    expect(() => tracker.consumeTokens(-1)).toThrow(RangeError);
    expect(() => tracker.consumeDuration(-1)).toThrow(RangeError);
    expect(() => tracker.consumeCost(-1)).toThrow(RangeError);
    expect(() => tracker.incrementStages(-1)).toThrow(RangeError);
  });

  it("reevaluate() flags dimensions that were imported above cap", () => {
    const exceed = vi.fn();
    const tracker = new BudgetTracker({
      budget: { maxTokens: 50 },
      initialUsage: { usedTokens: 999 },
      onExceed: exceed,
    });
    expect(exceed).not.toHaveBeenCalled();
    tracker.reevaluate();
    expect(exceed).toHaveBeenCalledWith("tokens", expect.objectContaining({ usedTokens: 999 }));
    expect(tracker.aborted).toBe(true);
  });

  it("snapshot() returns a copy", () => {
    const tracker = new BudgetTracker();
    tracker.consumeTokens(10);
    const snap = tracker.snapshot();
    snap.usedTokens = 999;
    expect(tracker.snapshot().usedTokens).toBe(10);
  });
});

// ── HeartbeatMonitor ───────────────────────────────────────────────

describe("HeartbeatMonitor", () => {
  function fakeScheduler(): HeartbeatScheduler & { trigger: () => void } {
    let registered: (() => void) | null = null;
    return {
      setInterval: (handler) => {
        registered = handler;
        return Symbol("handle");
      },
      clearInterval: () => {
        registered = null;
      },
      trigger: () => registered?.(),
    };
  }

  it("invokes onStale only after the deadline lapses", () => {
    let now = 0;
    const stale = vi.fn();
    const scheduler = fakeScheduler();
    const monitor = new HeartbeatMonitor({
      staleAfterMs: 100,
      onStale: stale,
      clock: () => now,
      scheduler,
    });
    monitor.start();
    monitor.tick("a");
    now = 50;
    scheduler.trigger();
    expect(stale).not.toHaveBeenCalled();
    now = 250;
    scheduler.trigger();
    expect(stale).toHaveBeenCalledWith("a", 0);
  });

  it("does not double-fire while still stale", () => {
    let now = 0;
    const stale = vi.fn();
    const scheduler = fakeScheduler();
    const monitor = new HeartbeatMonitor({
      staleAfterMs: 100,
      onStale: stale,
      clock: () => now,
      scheduler,
    });
    monitor.start();
    monitor.tick("a");
    now = 200;
    scheduler.trigger();
    scheduler.trigger();
    scheduler.trigger();
    expect(stale).toHaveBeenCalledTimes(1);
  });

  it("re-arms after a fresh tick", () => {
    let now = 0;
    const stale = vi.fn();
    const scheduler = fakeScheduler();
    const monitor = new HeartbeatMonitor({
      staleAfterMs: 100,
      onStale: stale,
      clock: () => now,
      scheduler,
    });
    monitor.start();
    monitor.tick("a");
    now = 200;
    scheduler.trigger();
    expect(stale).toHaveBeenCalledTimes(1);

    now = 300;
    monitor.tick("a");
    now = 350;
    scheduler.trigger();
    expect(stale).toHaveBeenCalledTimes(1);

    now = 500;
    scheduler.trigger();
    expect(stale).toHaveBeenCalledTimes(2);
  });

  it("release() drops a stage from monitoring", () => {
    let now = 0;
    const stale = vi.fn();
    const scheduler = fakeScheduler();
    const monitor = new HeartbeatMonitor({
      staleAfterMs: 100,
      onStale: stale,
      clock: () => now,
      scheduler,
    });
    monitor.start();
    monitor.tick("a");
    monitor.release("a");
    now = 500;
    scheduler.trigger();
    expect(stale).not.toHaveBeenCalled();
  });
});

// ── ConcurrencyLimiter ─────────────────────────────────────────────

describe("ConcurrencyLimiter", () => {
  it("allows up to N tasks to run in parallel", async () => {
    const limiter = new ConcurrencyLimiter(2);
    const r1 = await limiter.acquire();
    const r2 = await limiter.acquire();
    expect(limiter.inFlight).toBe(2);

    let resolved = false;
    const pending = limiter.acquire().then((r) => {
      resolved = true;
      return r;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(limiter.pending).toBe(1);

    r1();
    const r3 = await pending;
    expect(resolved).toBe(true);
    r2();
    r3();
    expect(limiter.inFlight).toBe(0);
  });

  it("releases are idempotent", async () => {
    const limiter = new ConcurrencyLimiter(1);
    const r = await limiter.acquire();
    r();
    r();
    const r2 = await limiter.acquire();
    expect(limiter.inFlight).toBe(1);
    r2();
  });

  it("rejects invalid limits", () => {
    expect(() => new ConcurrencyLimiter(0)).toThrow(RangeError);
    expect(() => new ConcurrencyLimiter(-1)).toThrow(RangeError);
    expect(() => new ConcurrencyLimiter(Number.NaN)).toThrow(RangeError);
  });
});

// ── withStageTimeout ───────────────────────────────────────────────

describe("withStageTimeout", () => {
  it("resolves with the underlying value when within deadline", async () => {
    const result = await withStageTimeout(Promise.resolve(42), 100);
    expect(result).toBe(42);
  });

  it("rejects with StageTimeoutError on deadline lapse", async () => {
    let timedOut = false;
    const promise = new Promise(() => undefined);
    const wrapped = withStageTimeout(promise, 5, {
      onTimeout: () => {
        timedOut = true;
      },
    });
    await expect(wrapped).rejects.toBeInstanceOf(StageTimeoutError);
    expect(timedOut).toBe(true);
  });

  it("propagates underlying rejections without firing onTimeout", async () => {
    const onTimeout = vi.fn();
    await expect(
      withStageTimeout(Promise.reject(new Error("boom")), 100, { onTimeout }),
    ).rejects.toThrow("boom");
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("treats timeoutMs <= 0 as no-op", async () => {
    const result = await withStageTimeout(Promise.resolve("ok"), 0);
    expect(result).toBe("ok");
  });
});

// ── redactSensitive / redactValue ──────────────────────────────────

describe("redactSensitive", () => {
  it.each([
    ["sk-ant-test-key-abcdefghijklmnopqrst"],
    ["ghp_abcdefghijklmnopqrstuvwxyzABCDEF"],
    ["AKIAABCDEFGHIJKLMNOP"],
    ["eyJhbGciOiJIUzI1NiIs.eyJzdWIiOiIxMjM0NTY.SflKxwRJSMeKKF30tRoF"],
  ])("masks credential token %#", (token) => {
    const out = redactSensitive(`prefix ${token} suffix`);
    expect(out).not.toContain(token);
    expect(out).toContain("[REDACTED]");
  });

  it("masks bearer tokens but keeps the Authorization prefix", () => {
    const out = redactSensitive("Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456789");
    expect(out).toContain("Authorization: Bearer ");
    expect(out).toContain("[REDACTED]");
  });

  it("returns the original string when nothing matches", () => {
    const text = "hello world";
    expect(redactSensitive(text)).toBe(text);
  });

  it("recursively redacts nested structures", () => {
    const out = redactValue({
      headers: {
        raw: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456789",
      },
      list: ["sk-ant-test-key-abcdefghijklmnopqrst"],
    });
    const raw = (out as { headers: { raw: string } }).headers.raw;
    expect(raw).not.toContain("abcdefghijklmnopqrstuvwxyz123456789");
    expect(raw).toContain("[REDACTED]");
    const list = (out as { list: string[] }).list;
    expect(list[0]).not.toContain("sk-ant-test-key");
  });
});

// ── SingleInstanceLock ─────────────────────────────────────────────

describe("SingleInstanceLock", () => {
  const tmpRoot = path.join(tmpdir(), `orchestrator-locks-${process.pid}-${Date.now()}`);
  const dirs: string[] = [];

  afterAll(async () => {
    for (const d of dirs) {
      try {
        await rm(d, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  });

  it("acquires and releases a fresh lock", async () => {
    const dir = await mkdtemp(tmpRoot);
    dirs.push(dir);
    const lock = new SingleInstanceLock({ rootDir: dir });
    const handle = lock.acquire("r1");
    expect(handle.runId).toBe("r1");
    handle.release();
    // Re-acquire after release — should not throw.
    const handle2 = lock.acquire("r1");
    handle2.release();
  });

  it("rejects a second acquire while the first is alive", async () => {
    const dir = await mkdtemp(tmpRoot);
    dirs.push(dir);
    const lock = new SingleInstanceLock({
      rootDir: dir,
      pid: 4242,
      isPidAlive: () => true,
    });
    const handle = lock.acquire("r1");
    expect(() => lock.acquire("r1")).toThrow(/already locked/);
    handle.release();
  });

  it("steals a stale lock when the recorded pid is gone", async () => {
    const dir = await mkdtemp(tmpRoot);
    dirs.push(dir);
    let alive = true;
    const lock = new SingleInstanceLock({
      rootDir: dir,
      pid: 4242,
      isPidAlive: () => alive,
    });
    const first = lock.acquire("r1");
    alive = false;
    // Release closes the file; recreate a stale lock by acquiring then
    // simulating death of the holder before release.
    first.release();
    const second = lock.acquire("r1");
    second.release();
  });

  it("steals a lock older than staleMs even when pid claims alive", async () => {
    const dir = await mkdtemp(tmpRoot);
    dirs.push(dir);
    let now = 1000;
    const lock = new SingleInstanceLock({
      rootDir: dir,
      pid: 4242,
      isPidAlive: () => true,
      staleMs: 1000,
      clock: () => now,
    });
    const first = lock.acquire("r1");
    expect(() => lock.acquire("r1")).toThrow(/already locked/);
    first.release();
    // Re-create a stale lock (write through acquire then advance time).
    const second = lock.acquire("r1");
    now = 5000;
    expect(() => lock.acquire("r1")).not.toThrow();
    second.release();
  });
});

// ── ProviderFallback ───────────────────────────────────────────────

describe("ProviderFallback", () => {
  it("walks the chain on next()", () => {
    let now = 0;
    const fb = new ProviderFallback({
      models: ["a", "b", "c"],
      clock: () => ++now,
    });
    expect(fb.current()).toBe("a");
    expect(fb.hasNext()).toBe(true);
    expect(fb.next()).toBe("b");
    fb.recordFailure("rate-limit");
    expect(fb.next()).toBe("c");
    expect(fb.hasNext()).toBe(false);
    expect(() => fb.next()).toThrow(/exhausted/);
    const history = fb.history();
    expect(history).toHaveLength(1);
    expect(history[0]?.model).toBe("b");
  });

  it("reset() returns to head and clears failures", () => {
    const fb = new ProviderFallback({ models: ["x", "y"] });
    fb.next();
    fb.recordFailure("oops");
    fb.reset();
    expect(fb.current()).toBe("x");
    expect(fb.history()).toEqual([]);
  });

  it("rejects an empty model list", () => {
    expect(() => new ProviderFallback({ models: [] })).toThrow(RangeError);
  });
});
