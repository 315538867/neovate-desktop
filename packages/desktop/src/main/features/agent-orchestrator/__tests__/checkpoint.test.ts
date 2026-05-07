/**
 * Wave 3.2 commit 2.2 — Persistence & recovery unit tests.
 *
 * Exercises the four persistence stores, the recovery service, the
 * sandbox validator, and the resume preamble builder. The IStorageService
 * boundary is faked with an in-memory map so tests stay fast and avoid
 * Electron app-paths bootstrap.
 */

import type Store from "electron-store";

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type {
  Run,
  RunStatus,
  StageNode,
} from "../../../../shared/features/agent-orchestrator/types";
import type { IStorageService } from "../../../core/storage-service";

import { CheckpointManager } from "../persistence/checkpoint-manager";
import { EventStore } from "../persistence/event-store";
import { PartialOutputStore } from "../persistence/partial-output-store";
import { RunStore } from "../persistence/run-store";
import { RecoveryService } from "../recovery/recovery-orchestrator";
import { buildResumePreamble } from "../recovery/resume-prompt-builder";
import { validateSandbox } from "../recovery/sandbox-validator";

// ── In-memory fake of IStorageService ───────────────────────────────

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
    if (!namespace) throw new Error("namespace required");
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

function makeRun(partial: Partial<Run> & Pick<Run, "id">): Run {
  return {
    id: partial.id,
    templateId: partial.templateId ?? "tpl-1",
    templateVersion: partial.templateVersion ?? "1.0.0",
    projectId: partial.projectId,
    cwd: partial.cwd ?? "/tmp/work",
    status: partial.status ?? "running",
    currentStageId: partial.currentStageId,
    startedAt: partial.startedAt ?? 1000,
    completedAt: partial.completedAt,
    budget: partial.budget,
    budgetUsage: partial.budgetUsage ?? {
      usedTokens: 0,
      usedDurationMs: 0,
      usedCostUsd: 0,
      completedStages: 0,
    },
    executions: partial.executions ?? [],
    error: partial.error,
  };
}

// ── RunStore ───────────────────────────────────────────────────────

describe("RunStore", () => {
  let storage: FakeStorage;
  let runStore: RunStore;

  beforeEach(() => {
    storage = new FakeStorage();
    runStore = new RunStore(storage);
  });

  it("saves and retrieves runs", () => {
    const run = makeRun({ id: "r1" });
    runStore.save(run);
    expect(runStore.get("r1")).toEqual(run);
    expect(runStore.get("missing")).toBeUndefined();
  });

  it("filters list by projectId, status, and limit", () => {
    runStore.save(makeRun({ id: "r1", projectId: "p1", status: "running", startedAt: 100 }));
    runStore.save(makeRun({ id: "r2", projectId: "p1", status: "completed", startedAt: 300 }));
    runStore.save(makeRun({ id: "r3", projectId: "p2", status: "completed", startedAt: 200 }));

    expect(runStore.list({ projectId: "p1" }).map((r) => r.id)).toEqual(["r2", "r1"]);
    expect(runStore.list({ status: ["completed"] }).map((r) => r.id)).toEqual(["r2", "r3"]);
    expect(runStore.list({ limit: 2 }).map((r) => r.id)).toEqual(["r2", "r3"]);
  });

  it("derives RunSummary stage counts from executions", () => {
    runStore.save(
      makeRun({
        id: "r1",
        executions: [
          {
            stageId: "a",
            branchIndex: 0,
            status: "succeeded",
            startedAt: 100,
            completedAt: 110,
          },
          {
            stageId: "b",
            branchIndex: 0,
            status: "failed",
            startedAt: 120,
            completedAt: 130,
          },
        ],
      }),
    );
    const [summary] = runStore.list();
    expect(summary?.completedStageCount).toBe(1);
    expect(summary?.totalStageCount).toBe(2);
  });

  it("setStatus updates status without losing the rest", () => {
    runStore.save(makeRun({ id: "r1", status: "running", currentStageId: "stage-a" }));
    runStore.setStatus("r1", "completed", 500);
    const persisted = runStore.get("r1");
    expect(persisted?.status).toBe("completed");
    expect(persisted?.completedAt).toBe(500);
    expect(persisted?.currentStageId).toBe("stage-a");
  });

  it("markRunningAsInterruptedUnsafe flips running + paused_user_gate rows", () => {
    runStore.save(makeRun({ id: "r1", status: "running" }));
    runStore.save(makeRun({ id: "r2", status: "paused_user_gate" }));
    runStore.save(makeRun({ id: "r3", status: "completed", completedAt: 999 }));
    runStore.save(makeRun({ id: "r4", status: "failed" }));

    const flipped = runStore.markRunningAsInterruptedUnsafe(2000);
    expect(flipped).toBe(2);
    expect(runStore.get("r1")?.status).toBe("interrupted_unsafe");
    expect(runStore.get("r1")?.completedAt).toBe(2000);
    expect(runStore.get("r2")?.status).toBe("interrupted_unsafe");
    expect(runStore.get("r3")?.status).toBe("completed");
    expect(runStore.get("r3")?.completedAt).toBe(999);
    expect(runStore.get("r4")?.status).toBe("failed");
  });

  it("ignores malformed entries (missing id / mismatched key / non-object) during startup cleanup", () => {
    // Simulate corrupted / electron-store-internal entries living next to
    // real Run rows. Without filtering, markRunningAsInterruptedUnsafe()
    // would call store.set(undefined, ...) and crash.
    const fake = storage.scoped(RunStore.NAMESPACE) as unknown as {
      set(arg1: string | Record<string, unknown>, value?: unknown): void;
    };
    fake.set("__internal__", { migrations: { version: "0.0.0" } });
    fake.set("orphan", { status: "running" }); // no id field
    fake.set("mismatched", { id: "different-key", status: "running" });
    runStore.save(makeRun({ id: "r1", status: "running" }));

    expect(() => runStore.markRunningAsInterruptedUnsafe(3000)).not.toThrow();
    expect(runStore.get("r1")?.status).toBe("interrupted_unsafe");
  });

  it("save throws on missing/empty run id", () => {
    expect(() => runStore.save({ ...makeRun({ id: "ok" }), id: "" })).toThrow(/non-empty/);
    expect(() =>
      runStore.save({ ...makeRun({ id: "ok" }), id: undefined as unknown as string }),
    ).toThrow(/non-empty/);
  });
});

// ── EventStore ─────────────────────────────────────────────────────

describe("EventStore", () => {
  it("appends and reads events per run", () => {
    const storage = new FakeStorage();
    const events = new EventStore(storage);
    events.append("r1", { type: "run.start", seq: 1, runId: "r1", timestamp: 1, templateId: "t" });
    events.appendBatch("r1", [
      { type: "stage.start", seq: 2, runId: "r1", timestamp: 2, stageId: "a", branchIndex: 0 },
      {
        type: "stage.end",
        seq: 3,
        runId: "r1",
        timestamp: 3,
        stageId: "a",
        branchIndex: 0,
        status: "succeeded",
        durationMs: 1,
      },
    ]);
    expect(events.list("r1")).toHaveLength(3);
    expect(events.lastSeq("r1")).toBe(3);
    expect(events.list("missing")).toEqual([]);
    expect(events.lastSeq("missing")).toBe(0);
    events.clear("r1");
    expect(events.list("r1")).toEqual([]);
  });
});

// ── PartialOutputStore ─────────────────────────────────────────────

describe("PartialOutputStore", () => {
  it("scopes outputs by run / stage / branch and clears per run", () => {
    const storage = new FakeStorage();
    const store = new PartialOutputStore(storage);
    const key = { runId: "r1", stageId: "a", branchIndex: 0 };
    store.set(key, { payload: { progress: 0.5 }, changedFiles: ["src/a.ts"] });
    expect(store.get(key)?.payload).toEqual({ progress: 0.5 });
    store.set({ runId: "r2", stageId: "a", branchIndex: 0 }, { payload: 1, changedFiles: [] });
    store.clearRun("r1");
    expect(store.get(key)).toBeUndefined();
    expect(store.get({ runId: "r2", stageId: "a", branchIndex: 0 })).toEqual({
      payload: 1,
      changedFiles: [],
    });
  });
});

// ── CheckpointManager ──────────────────────────────────────────────

describe("CheckpointManager", () => {
  it("records snapshots and returns the latest per (stage, branch)", () => {
    const storage = new FakeStorage();
    let now = 0;
    let n = 0;
    const cm = new CheckpointManager({
      storage,
      clock: () => ++now,
      idFactory: () => `cp-${++n}`,
    });
    cm.record({ runId: "r1", stageId: "a", branchIndex: 0, payload: { v: 1 } });
    cm.record({ runId: "r1", stageId: "a", branchIndex: 0, payload: { v: 2 } });
    cm.record({ runId: "r1", stageId: "a", branchIndex: 1, payload: { v: 99 } });
    cm.record({ runId: "r1", stageId: "b", branchIndex: 0, payload: { v: 7 } });

    expect(cm.list("r1")).toHaveLength(4);
    expect(cm.getLatest("r1", "a", 0)?.payload).toEqual({ v: 2 });
    expect(cm.getLatest("r1", "a", 1)?.payload).toEqual({ v: 99 });
    expect(cm.getLatest("r1", "missing", 0)).toBeUndefined();

    cm.clear("r1");
    expect(cm.list("r1")).toEqual([]);
  });
});

// ── RecoveryService ────────────────────────────────────────────────

describe("RecoveryService", () => {
  function makeSetup(now = 9000) {
    const storage = new FakeStorage();
    const runStore = new RunStore(storage);
    const checkpointManager = new CheckpointManager({
      storage,
      clock: () => 1,
      idFactory: () => "cp-id",
    });
    const recovery = new RecoveryService({
      runStore,
      checkpointManager,
      clock: () => now,
    });
    return { storage, runStore, checkpointManager, recovery };
  }

  it("markInterruptedAtStartup labels stale running rows", () => {
    const { runStore, recovery } = makeSetup(5000);
    runStore.save(makeRun({ id: "r1", status: "running" }));
    runStore.save(makeRun({ id: "r2", status: "completed", completedAt: 1000 }));
    expect(recovery.markInterruptedAtStartup()).toEqual({ marked: 1 });
    expect(runStore.get("r1")?.status).toBe("interrupted_unsafe");
    expect(runStore.get("r1")?.completedAt).toBe(5000);
    expect(runStore.get("r2")?.status).toBe("completed");
  });

  it("markGracefulShutdown only flips live runs", () => {
    const { runStore, recovery } = makeSetup(7000);
    runStore.save(makeRun({ id: "r1", status: "running" }));
    runStore.save(makeRun({ id: "r2", status: "completed", completedAt: 100 }));
    recovery.markGracefulShutdown("r1");
    recovery.markGracefulShutdown("r2");
    recovery.markGracefulShutdown("missing");
    expect(runStore.get("r1")?.status).toBe("interrupted_graceful");
    expect(runStore.get("r1")?.completedAt).toBe(7000);
    expect(runStore.get("r2")?.status).toBe("completed");
    expect(runStore.get("r2")?.completedAt).toBe(100);
  });

  it("listRecoverable surfaces graceful + unsafe + gate-paused, sorted by interruptedAt desc", () => {
    const { runStore, checkpointManager, recovery } = makeSetup();
    runStore.save(
      makeRun({
        id: "r-graceful",
        status: "interrupted_graceful",
        startedAt: 100,
        completedAt: 200,
      }),
    );
    runStore.save(
      makeRun({
        id: "r-unsafe",
        status: "interrupted_unsafe",
        startedAt: 100,
        completedAt: 300,
      }),
    );
    runStore.save(makeRun({ id: "r-gate", status: "paused_user_gate", startedAt: 250 }));
    runStore.save(makeRun({ id: "r-done", status: "completed", completedAt: 999 }));
    checkpointManager.record({
      runId: "r-graceful",
      stageId: "a",
      branchIndex: 0,
      payload: { v: 1 },
    });

    const list = recovery.listRecoverable();
    expect(list.map((r) => r.runId)).toEqual(["r-unsafe", "r-gate", "r-graceful"]);
    const graceful = list.find((r) => r.runId === "r-graceful");
    expect(graceful?.hasCheckpoint).toBe(true);
    const unsafe = list.find((r) => r.runId === "r-unsafe");
    expect(unsafe?.hasCheckpoint).toBe(false);
  });

  it("uses sandboxLookup to populate sandboxPath", () => {
    const { runStore, checkpointManager } = makeSetup();
    runStore.save(makeRun({ id: "r1", status: "interrupted_graceful", completedAt: 100 }));
    const recovery = new RecoveryService({
      runStore,
      checkpointManager,
      sandboxLookup: (run) => `/sandbox/${run.id}`,
    });
    expect(recovery.listRecoverable()[0]?.sandboxPath).toBe("/sandbox/r1");
  });
});

// ── validateSandbox ────────────────────────────────────────────────

describe("validateSandbox", () => {
  const tmpRoot = path.join(tmpdir(), `orchestrator-sandbox-${process.pid}-${Date.now()}`);
  const dirs: string[] = [];

  afterAll(async () => {
    for (const d of dirs) {
      try {
        await rm(d, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  it("treats undefined as a no-op", async () => {
    const result = await validateSandbox(undefined);
    expect(result.valid).toBe(true);
    expect(result.exists).toBe(false);
  });

  it("flags missing paths", async () => {
    const result = await validateSandbox(path.join(tmpRoot, "ghost"));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("missing-sandbox-path");
  });

  it("flags non-directory paths", async () => {
    const dir = await mkdtemp(tmpRoot);
    dirs.push(dir);
    const file = path.join(dir, "not-a-dir.txt");
    await writeFile(file, "hi", "utf8");
    const result = await validateSandbox(file);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("not-a-directory");
  });

  it("flags directories without a .git marker", async () => {
    const dir = await mkdtemp(tmpRoot);
    dirs.push(dir);
    const result = await validateSandbox(dir);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("missing-git-marker");
  });

  it("accepts a directory with a .git entry", async () => {
    const dir = await mkdtemp(tmpRoot);
    dirs.push(dir);
    await mkdir(path.join(dir, ".git"));
    const result = await validateSandbox(dir);
    expect(result.valid).toBe(true);
    expect(result.exists).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});

// ── buildResumePreamble ────────────────────────────────────────────

describe("buildResumePreamble", () => {
  const stage: StageNode = {
    id: "implementer",
    kind: "implementer",
    executor: "claude-code",
    dependsOn: [],
    prompt: "do work",
    userGate: false,
  };

  it("includes prior failure context and strategy guidance", () => {
    const run = makeRun({
      id: "r1",
      executions: [
        {
          stageId: "implementer",
          branchIndex: 0,
          status: "failed",
          startedAt: 1,
          completedAt: 2,
          error: { level: "L3", message: "oh no" },
          output: { summary: "did half the work", changedFiles: [] },
        },
      ],
    });
    const preamble = buildResumePreamble({
      run,
      stage,
      strategy: "resume_from_checkpoint",
      note: "be careful with migrations",
    });
    expect(preamble).toContain("strategy=resume_from_checkpoint");
    expect(preamble).toContain("previous_status=failed");
    expect(preamble).toContain("previous_error=oh no");
    expect(preamble).toContain("previous_summary=did half the work");
    expect(preamble).toContain("user_note=be careful with migrations");
    expect(preamble).toContain("Continue from the last successful checkpoint");
  });

  it("omits previous fields when the stage has no prior execution", () => {
    const run = makeRun({ id: "r1" });
    const preamble = buildResumePreamble({ run, stage, strategy: "restart_failed_stage" });
    expect(preamble).not.toContain("previous_status");
    expect(preamble).not.toContain("user_note");
    expect(preamble).toContain("Restart this stage from scratch");
  });

  it.each<RunStatus | string>([
    "resume_from_checkpoint",
    "restart_failed_stage",
    "skip_failed_stage",
    "abort",
  ])("emits a guidance line for %s", (strategy) => {
    const run = makeRun({ id: "r1" });
    const preamble = buildResumePreamble({
      run,
      stage,
      strategy: strategy as never,
    });
    expect(preamble).toMatch(/^[A-Z]/m);
  });
});
