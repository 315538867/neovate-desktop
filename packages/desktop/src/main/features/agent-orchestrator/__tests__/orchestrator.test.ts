/**
 * Wave 3.2 commit 2.5 — Orchestrator façade integration tests.
 *
 * Exercises the public surface of `Orchestrator` against in-memory
 * persistence and stub executors. We deliberately drive the façade end
 * to end (startRun → trace → run.end) to catch regressions in the seam
 * wiring, not the leaf modules (those are covered separately).
 *
 * The IStorageService boundary is faked the same way as in
 * `checkpoint.test.ts`. WorktreeManager is stubbed via a no-op runner.
 */

import type Store from "electron-store";

import { describe, expect, it } from "vitest";

import type {
  PipelineTemplate,
  StageNode,
  TraceEvent,
} from "../../../../shared/features/agent-orchestrator/types";
import type { IStorageService } from "../../../core/storage-service";
import type { Executor, ExecutorContext, ExecutorInput, ExecutorResult } from "../executors/types";

import { ChangeTracker } from "../change-tracker";
import { ErrorStore } from "../errors/error-store";
import { RetryPolicy } from "../errors/retry-policy";
import { ExecutorRegistry } from "../executors/registry";
import { TraceEmitter } from "../observability/trace";
import { Orchestrator } from "../orchestrator";
import { CheckpointManager } from "../persistence/checkpoint-manager";
import { EventStore } from "../persistence/event-store";
import { PartialOutputStore } from "../persistence/partial-output-store";
import { RunStore } from "../persistence/run-store";
import { WorktreeManager } from "../sandbox/worktree-manager";
import { SubtaskTracker } from "../subtasks/subtask-tracker";
import { TemplateRegistry } from "../templates/registry";

// ── In-memory IStorageService fake ──────────────────────────────────

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

// ── Stub executor: emits the configured token usage and resolves ────

type StubBehaviour = (input: ExecutorInput, ctx: ExecutorContext) => Promise<ExecutorResult>;

class StubExecutor implements Executor {
  readonly kind = "llm-only" as const;
  constructor(private readonly behaviour: StubBehaviour) {}
  execute(input: ExecutorInput, ctx: ExecutorContext): Promise<ExecutorResult> {
    return this.behaviour(input, ctx);
  }
}

function defaultStubBehaviour(): StubBehaviour {
  return async (_input, ctx) => {
    ctx.emitProgress({ kind: "tokens", deltaInput: 50, deltaOutput: 100 });
    return {
      output: { payload: { ok: true }, changedFiles: [] },
      usage: {
        usedTokens: 150,
        usedDurationMs: 10,
        usedCostUsd: 0,
        completedStages: 1,
      },
    };
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function makeStage(partial: Partial<StageNode> & Pick<StageNode, "id">): StageNode {
  return {
    id: partial.id,
    kind: partial.kind ?? "implementer",
    executor: partial.executor ?? "llm-only",
    dependsOn: partial.dependsOn ?? [],
    prompt: partial.prompt ?? `do ${partial.id}`,
    userGate: partial.userGate ?? false,
    label: partial.label,
    model: partial.model,
    budget: partial.budget,
    sandbox: partial.sandbox,
    fanout: partial.fanout,
  };
}

function makeTemplate(stages: StageNode[], id = "test-template"): PipelineTemplate {
  return {
    id,
    name: id,
    description: "",
    version: "1.0.0",
    stages,
    source: "user",
  };
}

type Harness = {
  orchestrator: Orchestrator;
  storage: FakeStorage;
  traceEmitter: TraceEmitter;
  runStore: RunStore;
  registry: ExecutorRegistry;
  templates: TemplateRegistry;
  worktree: WorktreeManager;
  errorStore: ErrorStore;
};

function setup(opts: { behaviour?: StubBehaviour } = {}): Harness {
  const storage = new FakeStorage();
  const eventStore = new EventStore(storage);
  const traceEmitter = new TraceEmitter({ eventStore });
  const runStore = new RunStore(storage);
  const checkpointManager = new CheckpointManager({ storage });
  const partialOutputStore = new PartialOutputStore(storage);
  const errorStore = new ErrorStore({ storage });
  const retryPolicy = new RetryPolicy({ random: () => 0 });
  // Worktree runner is a no-op so tests don't shell out to git.
  const worktree = new WorktreeManager({
    root: "/tmp/orchestrator-test",
    runner: async () => {},
  });
  const registry = new ExecutorRegistry();
  registry.register(new StubExecutor(opts.behaviour ?? defaultStubBehaviour()));
  const templates = new TemplateRegistry();
  const changeTracker = new ChangeTracker();
  const subtaskTracker = new SubtaskTracker();

  const orchestrator = new Orchestrator({
    runStore,
    eventStore,
    checkpointManager,
    partialOutputStore,
    errorStore,
    traceEmitter,
    retryPolicy,
    worktreeManager: worktree,
    templateRegistry: templates,
    executorRegistry: registry,
    changeTracker,
    subtaskTracker,
  });

  return {
    orchestrator,
    storage,
    traceEmitter,
    runStore,
    registry,
    templates,
    worktree,
    errorStore,
  };
}

async function collectUntil(
  iter: AsyncIterableIterator<TraceEvent>,
  predicate: (ev: TraceEvent) => boolean,
  timeoutMs = 1000,
): Promise<TraceEvent[]> {
  const out: TraceEvent[] = [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await Promise.race([
      iter.next(),
      new Promise<{ value: undefined; done: true }>((resolve) =>
        setTimeout(
          () => resolve({ value: undefined, done: true }),
          Math.max(0, deadline - Date.now()),
        ),
      ),
    ]);
    if (r.done) break;
    out.push(r.value);
    if (predicate(r.value)) break;
  }
  return out;
}

// ── Tests ───────────────────────────────────────────────────────────

describe("Orchestrator — template management", () => {
  it("listTemplates returns registered templates", () => {
    const { orchestrator } = setup();
    expect(orchestrator.listTemplates()).toEqual([]);
    const tpl = makeTemplate([makeStage({ id: "a" })]);
    orchestrator.registerTemplate(tpl);
    const listed = orchestrator.listTemplates();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(tpl.id);
  });

  it("registerTemplate is idempotent (upsert semantics)", () => {
    const { orchestrator } = setup();
    const tpl = makeTemplate([makeStage({ id: "a" })]);
    orchestrator.registerTemplate(tpl);
    orchestrator.registerTemplate({ ...tpl, name: "renamed" });
    const listed = orchestrator.listTemplates();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.name).toBe("renamed");
  });
});

describe("Orchestrator — startRun lifecycle", () => {
  it("emits run.start → stage.start → stage.end → run.end for a single-stage template", async () => {
    const { orchestrator } = setup();
    const tpl = makeTemplate([makeStage({ id: "implement", prompt: "do {{task}}" })]);
    orchestrator.registerTemplate(tpl);

    const sub = orchestrator.subscribeAll();
    const run = await orchestrator.startRun({
      templateId: tpl.id,
      cwd: "/tmp/test",
      variables: { task: "say hi" },
    });
    expect(run.status).toBe("running");

    const events = await collectUntil(sub, (e) => e.type === "run.end");
    const types = events.map((e) => e.type);
    expect(types).toContain("run.start");
    expect(types).toContain("stage.start");
    expect(types).toContain("stage.end");
    expect(types).toContain("run.end");

    await sub.return?.(undefined);
  });

  it("persists final Run with completed status and budget snapshot", async () => {
    const { orchestrator, runStore } = setup();
    const tpl = makeTemplate([makeStage({ id: "implement" })]);
    orchestrator.registerTemplate(tpl);

    const sub = orchestrator.subscribeAll();
    const run = await orchestrator.startRun({ templateId: tpl.id, cwd: "/tmp/test" });
    await collectUntil(sub, (e) => e.type === "run.end");
    await sub.return?.(undefined);

    const persisted = runStore.get(run.id);
    expect(persisted).toBeDefined();
    expect(persisted!.status).toBe("completed");
    // BudgetTracker accumulates from `tokens` progress (50 + 100 = 150).
    expect(persisted!.budgetUsage.usedTokens).toBe(150);
  });

  it("getRun + listRuns reflect persisted Run", async () => {
    const { orchestrator } = setup();
    const tpl = makeTemplate([makeStage({ id: "implement" })]);
    orchestrator.registerTemplate(tpl);

    const sub = orchestrator.subscribeAll();
    const run = await orchestrator.startRun({
      templateId: tpl.id,
      cwd: "/tmp/test",
      projectId: "proj-1",
    });
    await collectUntil(sub, (e) => e.type === "run.end");
    await sub.return?.(undefined);

    expect(orchestrator.getRun(run.id)?.id).toBe(run.id);
    const summaries = orchestrator.listRuns({ projectId: "proj-1" });
    expect(summaries.map((s) => s.id)).toContain(run.id);
  });

  it("throws when templateId is unknown", async () => {
    const { orchestrator } = setup();
    await expect(orchestrator.startRun({ templateId: "nonexistent", cwd: "/tmp" })).rejects.toThrow(
      /unknown template/,
    );
  });
});

describe("Orchestrator — cancelRun", () => {
  it("cancels an in-flight run and emits run.cancel", async () => {
    let cancelTriggered: (() => void) | null = null;
    const cancelPromise = new Promise<void>((resolve) => {
      cancelTriggered = resolve;
    });
    const slowExecutor: StubBehaviour = async (input) => {
      await new Promise<void>((_resolve, reject) => {
        const onAbort = () => {
          input.signal.removeEventListener("abort", onAbort);
          reject(new Error("aborted"));
        };
        input.signal.addEventListener("abort", onAbort);
        // Mark that we're in-flight.
        cancelTriggered?.();
      });
      // Unreachable.
      return {
        output: { payload: undefined, changedFiles: [] },
        usage: { usedTokens: 0, usedDurationMs: 0, usedCostUsd: 0, completedStages: 0 },
      };
    };

    const { orchestrator } = setup({ behaviour: slowExecutor });
    const tpl = makeTemplate([makeStage({ id: "implement" })]);
    orchestrator.registerTemplate(tpl);

    const sub = orchestrator.subscribeAll();
    const run = await orchestrator.startRun({ templateId: tpl.id, cwd: "/tmp/test" });

    // Wait until the executor is actually in-flight before cancelling.
    await cancelPromise;
    const result = await orchestrator.cancelRun({ runId: run.id, reason: "user" });
    expect(result.cancelled).toBe(true);

    const events = await collectUntil(sub, (e) => e.type === "run.end");
    expect(events.some((e) => e.type === "run.cancel")).toBe(true);

    await sub.return?.(undefined);
  });

  it("returns cancelled=false for an unknown run", async () => {
    const { orchestrator } = setup();
    const result = await orchestrator.cancelRun({ runId: "nonexistent" });
    expect(result.cancelled).toBe(false);
  });
});

describe("Orchestrator — approveGate flow", () => {
  it("pauses on userGate=true, resumes on approveGate(approved=true)", async () => {
    const { orchestrator, runStore } = setup();
    const tpl = makeTemplate([
      makeStage({ id: "stage-a", userGate: true }),
      makeStage({ id: "stage-b", dependsOn: ["stage-a"] }),
    ]);
    orchestrator.registerTemplate(tpl);

    const sub = orchestrator.subscribeAll();
    const run = await orchestrator.startRun({ templateId: tpl.id, cwd: "/tmp/test" });

    // Wait for the gate request, then approve.
    const pre = await collectUntil(sub, (e) => e.type === "gate.requested");
    expect(pre.some((e) => e.type === "gate.requested")).toBe(true);

    const paused = runStore.get(run.id);
    expect(paused?.status).toBe("paused_user_gate");

    const approval = orchestrator.approveGate({
      runId: run.id,
      stageId: "stage-a",
      approved: true,
    });
    expect(approval.accepted).toBe(true);

    const post = await collectUntil(sub, (e) => e.type === "run.end");
    expect(post.some((e) => e.type === "gate.resolved")).toBe(true);
    expect(post.some((e) => e.type === "run.end")).toBe(true);

    const final = runStore.get(run.id);
    expect(final?.status).toBe("completed");

    await sub.return?.(undefined);
  });

  it("approveGate(approved=false) fails the stage and ends the run", async () => {
    const { orchestrator, runStore } = setup();
    const tpl = makeTemplate([
      makeStage({ id: "stage-a", userGate: true }),
      makeStage({ id: "stage-b", dependsOn: ["stage-a"] }),
    ]);
    orchestrator.registerTemplate(tpl);

    const sub = orchestrator.subscribeAll();
    const run = await orchestrator.startRun({ templateId: tpl.id, cwd: "/tmp/test" });

    await collectUntil(sub, (e) => e.type === "gate.requested");
    orchestrator.approveGate({ runId: run.id, stageId: "stage-a", approved: false });

    await collectUntil(sub, (e) => e.type === "run.end");
    const final = runStore.get(run.id);
    expect(final?.status).toBe("failed");
    await sub.return?.(undefined);
  });

  it("approveGate returns accepted=false for an unknown gate", () => {
    const { orchestrator } = setup();
    const result = orchestrator.approveGate({
      runId: "nope",
      stageId: "nope",
      approved: true,
    });
    expect(result.accepted).toBe(false);
  });
});

describe("Orchestrator — recovery & shutdown", () => {
  it("startupCleanup flips orphaned running rows to interrupted_unsafe", async () => {
    const { orchestrator, runStore } = setup();
    runStore.save({
      id: "stale-run",
      templateId: "t",
      templateVersion: "1.0.0",
      cwd: "/tmp",
      status: "running",
      startedAt: Date.now() - 10_000,
      budgetUsage: { usedTokens: 0, usedDurationMs: 0, usedCostUsd: 0, completedStages: 0 },
      executions: [],
    });

    const result = orchestrator.startupCleanup();
    expect(result.marked).toBe(1);

    const after = runStore.get("stale-run");
    expect(after?.status).toBe("interrupted_unsafe");

    expect(orchestrator.listRecoverableRuns().some((r) => r.runId === "stale-run")).toBe(true);
  });

  it("gracefulShutdown aborts active runs and flips them to interrupted_graceful", async () => {
    const slowExecutor: StubBehaviour = async (input) => {
      await new Promise<void>((_resolve, reject) => {
        const onAbort = () => {
          input.signal.removeEventListener("abort", onAbort);
          reject(new Error("aborted"));
        };
        input.signal.addEventListener("abort", onAbort);
      });
      return {
        output: { payload: undefined, changedFiles: [] },
        usage: { usedTokens: 0, usedDurationMs: 0, usedCostUsd: 0, completedStages: 0 },
      };
    };

    const { orchestrator, runStore } = setup({ behaviour: slowExecutor });
    const tpl = makeTemplate([makeStage({ id: "implement" })]);
    orchestrator.registerTemplate(tpl);

    const sub = orchestrator.subscribeAll();
    const run = await orchestrator.startRun({ templateId: tpl.id, cwd: "/tmp/test" });
    // Wait for the stage to actually start before shutting down.
    await collectUntil(sub, (e) => e.type === "stage.start");

    await orchestrator.gracefulShutdown();
    await sub.return?.(undefined);

    const final = runStore.get(run.id);
    expect(final?.status).toBe("interrupted_graceful");
  });

  it("resumeRunWithStrategy(abort) flips status to cancelled", async () => {
    const { orchestrator, runStore } = setup();
    runStore.save({
      id: "to-abort",
      templateId: "t",
      templateVersion: "1.0.0",
      cwd: "/tmp",
      status: "interrupted_unsafe",
      startedAt: Date.now() - 1000,
      budgetUsage: { usedTokens: 0, usedDurationMs: 0, usedCostUsd: 0, completedStages: 0 },
      executions: [],
    });

    const out = await orchestrator.resumeRunWithStrategy({ runId: "to-abort", strategy: "abort" });
    expect(out.status).toBe("cancelled");
    expect(runStore.get("to-abort")?.status).toBe("cancelled");
  });
});

describe("Orchestrator — subscriptions", () => {
  it("subscribeRun yields events scoped to one run", async () => {
    const { orchestrator } = setup();
    const tpl = makeTemplate([makeStage({ id: "implement" })]);
    orchestrator.registerTemplate(tpl);

    const run = await orchestrator.startRun({ templateId: tpl.id, cwd: "/tmp/test" });
    const iter = orchestrator.subscribeRun(run.id);
    const events = await collectUntil(iter, (e) => e.type === "run.end");
    expect(events.length).toBeGreaterThan(0);
    for (const ev of events) expect(ev.runId).toBe(run.id);
    await iter.return?.(undefined);
  });

  it("subscribeAll filtered by projectId only yields matching runs", async () => {
    const { orchestrator } = setup();
    const tpl = makeTemplate([makeStage({ id: "implement" })]);
    orchestrator.registerTemplate(tpl);

    const sub = orchestrator.subscribeAll({ projectId: "alpha" });
    const a = await orchestrator.startRun({
      templateId: tpl.id,
      cwd: "/tmp/a",
      projectId: "alpha",
    });
    const b = await orchestrator.startRun({ templateId: tpl.id, cwd: "/tmp/b", projectId: "beta" });

    const events = await collectUntil(sub, (e) => e.type === "run.end" && e.runId === a.id);
    for (const ev of events) expect(ev.runId).toBe(a.id);
    expect(events.some((e) => e.runId === b.id)).toBe(false);
    await sub.return?.(undefined);
  });
});
