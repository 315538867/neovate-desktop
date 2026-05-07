/**
 * Agent Orchestrator — service façade.
 *
 * Public surface for the oRPC layer (`router.ts`) and the main process
 * lifecycle hooks (`main/index.ts`). This is the single seam that wires
 * together every persistence layer, the trace emitter, the stage executor,
 * and the budget tracker into a coherent run.
 *
 * Responsibilities
 *   • Validate templates and stamp out new `Run` records.
 *   • Drive `StageExecutor.run()` per kicked-off run, supplying hooks
 *     that persist incremental progress, fan trace events, accumulate
 *     budget consumption, and pause on user gates.
 *   • Track in-flight runs so `cancelRun` can abort live executions and
 *     `gracefulShutdown` can flip them to `interrupted_graceful`.
 *   • Expose subscriptions / history reads via the embedded
 *     `TraceEmitter` and `RunStore`.
 *
 * Wave 3.2 commit 2.5 invariant: this file is the integration point;
 * leaf modules stay pure / framework-free. Process lifecycle (Electron
 * `before-quit`) wiring lives in `main/index.ts`.
 */

import debug from "debug";
import { randomUUID } from "node:crypto";

import type {
  Budget,
  GateDecision,
  PipelineTemplate,
  RecoverableRun,
  Run,
  RunStatus,
  RunSummary,
  StageNode,
  StartRunInput,
  TraceEvent,
} from "../../../shared/features/agent-orchestrator/types";
import type { ErrorStore } from "./errors/error-store";
import type { RetryPolicy } from "./errors/retry-policy";
import type { StageExecutorHooks } from "./executor";
import type { Executor, ExecutorProgress } from "./executors/types";
import type { TraceEmitter } from "./observability/trace";
import type { CheckpointManager } from "./persistence/checkpoint-manager";
import type { EventStore } from "./persistence/event-store";
import type { PartialOutputStore } from "./persistence/partial-output-store";
import type { RunStore, RunListFilter } from "./persistence/run-store";
import type { WorktreeManager } from "./sandbox/worktree-manager";

import { ChangeTracker } from "./change-tracker";
import { StageExecutor } from "./executor";
import { ExecutorRegistry } from "./executors/registry";
import { RecoveryService } from "./recovery/recovery-orchestrator";
import { BudgetTracker } from "./safety/budget";
import { architectStagePlugin } from "./stages/architect-stage";
import { implementerStagePlugin } from "./stages/implementer-stage";
import { StageRegistry } from "./stages/registry";
import { reviewerStagePlugin } from "./stages/reviewer-stage";
import { validatorStagePlugin } from "./stages/validator-stage";
import { SubtaskTracker } from "./subtasks/subtask-tracker";
import { loadTemplateRegistry, type LoadOptions } from "./templates/loader";
import { TemplateRegistry } from "./templates/registry";

const log = debug("neovate:orchestrator:facade");

export type OrchestratorDeps = {
  runStore: RunStore;
  eventStore: EventStore;
  checkpointManager: CheckpointManager;
  partialOutputStore: PartialOutputStore;
  errorStore: ErrorStore;
  traceEmitter: TraceEmitter;
  retryPolicy: RetryPolicy;
  worktreeManager: WorktreeManager;
  /** Pre-built registry; if omitted, a default one is created with built-ins only. */
  templateRegistry?: TemplateRegistry;
  /** Pre-built executor registry; the orchestrator does not enforce who registers what. */
  executorRegistry: ExecutorRegistry;
  stageRegistry?: StageRegistry;
  changeTracker?: ChangeTracker;
  subtaskTracker?: SubtaskTracker;
  /** Override for deterministic tests. */
  clock?: () => number;
  idFactory?: () => string;
};

type ActiveRunHandle = {
  abort: AbortController;
  budget: BudgetTracker;
  /** Promise that resolves when the run loop exits (for tests / shutdown). */
  done: Promise<void>;
};

type GateResolver = {
  resolve: (approved: boolean) => void;
};

export class Orchestrator {
  readonly templateRegistry: TemplateRegistry;
  readonly executorRegistry: ExecutorRegistry;
  readonly stageRegistry: StageRegistry;
  readonly traceEmitter: TraceEmitter;

  private readonly runStore: RunStore;
  private readonly checkpointManager: CheckpointManager;
  private readonly errorStore: ErrorStore;
  private readonly worktreeManager: WorktreeManager;
  // `eventStore`, `partialOutputStore`, `retryPolicy` deps are accepted
  // by the constructor but not stored as fields yet — they'll be wired
  // into subsequent wave-3 modules (event replay, partial output cache,
  // retry/backoff). Keeping them off the class prevents `noUnusedLocals`
  // noise without dropping them from `OrchestratorDeps`.
  private readonly changeTracker: ChangeTracker;
  private readonly subtaskTracker: SubtaskTracker;
  private readonly recoveryService: RecoveryService;
  private readonly stageExecutor: StageExecutor;

  private readonly clock: () => number;
  private readonly idFactory: () => string;

  private readonly activeRuns = new Map<string, ActiveRunHandle>();
  private readonly pendingGates = new Map<string, GateResolver>();

  constructor(deps: OrchestratorDeps) {
    this.runStore = deps.runStore;
    this.checkpointManager = deps.checkpointManager;
    this.errorStore = deps.errorStore;
    this.traceEmitter = deps.traceEmitter;
    this.worktreeManager = deps.worktreeManager;
    this.executorRegistry = deps.executorRegistry;
    this.templateRegistry = deps.templateRegistry ?? new TemplateRegistry();
    this.stageRegistry = deps.stageRegistry ?? buildDefaultStageRegistry();
    this.changeTracker = deps.changeTracker ?? new ChangeTracker();
    this.subtaskTracker = deps.subtaskTracker ?? new SubtaskTracker();
    this.clock = deps.clock ?? Date.now;
    this.idFactory = deps.idFactory ?? randomUUID;

    this.recoveryService = new RecoveryService({
      runStore: this.runStore,
      checkpointManager: this.checkpointManager,
      sandboxLookup: (run) => {
        const entry = this.worktreeManager.listByRun(run.id)[0];
        return entry?.path;
      },
      clock: this.clock,
    });

    this.stageExecutor = new StageExecutor({
      registry: this.executorRegistry,
      hooks: this.buildExecutorHooks(),
    });
  }

  // ── Template registration ──────────────────────────────────────────

  /** Register a single pipeline template (idempotent via upsert). */
  registerTemplate(template: PipelineTemplate): void {
    this.templateRegistry.upsert(template);
  }

  /** Bulk-load template directories on top of the existing registry. */
  async loadTemplates(opts: LoadOptions = {}): Promise<{ errors: Error[] }> {
    const { registry, errors } = await loadTemplateRegistry(opts);
    for (const tpl of registry.list()) {
      this.templateRegistry.upsert(tpl);
    }
    return { errors };
  }

  // ── Contract leaves ────────────────────────────────────────────────

  listTemplates(): PipelineTemplate[] {
    return this.templateRegistry.list();
  }

  async startRun(input: StartRunInput): Promise<Run> {
    const template = this.templateRegistry.resolve(input.templateId);
    if (!template) {
      throw new Error(`[orchestrator] unknown template: ${input.templateId}`);
    }

    const runId = this.idFactory();
    const run = this.createRunRecord(runId, template, input);
    this.runStore.save(run);

    const abort = new AbortController();
    const budget = new BudgetTracker({
      budget: run.budget,
      onExceed: (dimension, usage) => {
        this.traceEmitter.emit({
          type: "budget.exceeded",
          runId,
          timestamp: this.clock(),
          dimension,
          usage,
        });
        abort.abort(`budget-${dimension}`);
      },
    });

    this.traceEmitter.emit({
      type: "run.start",
      runId,
      timestamp: this.clock(),
      templateId: template.id,
    });

    const done = this.executeRun(runId, template, input, abort, budget);
    this.activeRuns.set(runId, { abort, budget, done });
    return run;
  }

  getRun(runId: string): Run | null {
    return this.runStore.get(runId) ?? null;
  }

  listRuns(filter: RunListFilter | undefined = {}): RunSummary[] {
    return this.runStore.list(filter ?? {});
  }

  async cancelRun(args: { runId: string; reason?: string }): Promise<{ cancelled: boolean }> {
    const handle = this.activeRuns.get(args.runId);
    if (!handle) return { cancelled: false };

    this.traceEmitter.emit({
      type: "run.cancel",
      runId: args.runId,
      timestamp: this.clock(),
      reason: args.reason,
    });

    // Resolve any pending gates so the executor unblocks promptly.
    for (const [key, pending] of Array.from(this.pendingGates.entries())) {
      if (key.startsWith(`${args.runId}#`)) {
        this.pendingGates.delete(key);
        pending.resolve(false);
      }
    }

    handle.abort.abort(args.reason ?? "user-cancel");
    return { cancelled: true };
  }

  listRecoverableRuns(): RecoverableRun[] {
    return this.recoveryService.listRecoverable();
  }

  /**
   * Wave 3.2 minimal viable resume:
   *   `abort`              — flip status to `cancelled`, clear sandbox.
   *   `restart_failed_stage` / `resume_from_checkpoint` /
   *   `skip_failed_stage`  — return the current run unchanged. The
   *   richer resume semantics ride a follow-up commit; the trace
   *   `recovery.resumed` event is emitted regardless so the UI gets
   *   immediate feedback.
   */
  async resumeRunWithStrategy(args: {
    runId: string;
    strategy: import("../../../shared/features/agent-orchestrator/types").ResumeStrategy;
    note?: string;
  }): Promise<Run> {
    const run = this.runStore.get(args.runId);
    if (!run) throw new Error(`[orchestrator] run not found: ${args.runId}`);

    this.traceEmitter.emit({
      type: "recovery.resumed",
      runId: args.runId,
      timestamp: this.clock(),
      strategy: args.strategy,
    });

    if (args.strategy === "abort") {
      run.status = "cancelled";
      run.completedAt = this.clock();
      this.runStore.save(run);
      await this.worktreeManager.removeRun(run.id);
      return run;
    }
    return run;
  }

  approveGate(decision: GateDecision): { accepted: boolean } {
    const key = gateKey(decision.runId, decision.stageId);
    const pending = this.pendingGates.get(key);
    if (!pending) return { accepted: false };
    this.pendingGates.delete(key);
    this.traceEmitter.emit({
      type: "gate.resolved",
      runId: decision.runId,
      timestamp: this.clock(),
      stageId: decision.stageId,
      approved: decision.approved,
    });
    pending.resolve(decision.approved);
    return { accepted: true };
  }

  /** Subscribe to all trace events for a single run. */
  subscribeRun(runId: string): AsyncIterableIterator<TraceEvent> {
    return this.traceEmitter.subscribeRun(runId);
  }

  /**
   * Subscribe to all trace events across runs, optionally filtered by
   * `projectId`. The filter walks the run store per event so it stays
   * accurate even if a run's project association changes.
   */
  subscribeAll(filter: { projectId?: string } = {}): AsyncIterableIterator<TraceEvent> {
    const inner = this.traceEmitter.subscribeAll();
    if (!filter.projectId) return inner;
    const projectId = filter.projectId;
    const store = this.runStore;
    const filtered: AsyncIterableIterator<TraceEvent> = {
      [Symbol.asyncIterator]() {
        return filtered;
      },
      next: async () => {
        for (;;) {
          const r = await inner.next();
          if (r.done) return r;
          const run = store.get(r.value.runId);
          if (run?.projectId === projectId) return r;
        }
      },
      return: async (value) => {
        if (inner.return) return inner.return(value);
        return { value, done: true };
      },
    };
    return filtered;
  }

  listCheckpoints(runId: string) {
    return this.checkpointManager.list(runId);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  /**
   * Boot-time reconciliation. Marks any `running`/`paused_user_gate` row
   * as `interrupted_unsafe` and emits a `recovery.detected` event so the
   * UI can surface the resume dialog.
   */
  startupCleanup(): { marked: number } {
    const result = this.recoveryService.markInterruptedAtStartup();
    if (result.marked === 0) return result;
    for (const recoverable of this.recoveryService.listRecoverable()) {
      this.traceEmitter.emit({
        type: "recovery.detected",
        runId: recoverable.runId,
        timestamp: this.clock(),
        foundStatus: recoverable.lastStatus,
      });
    }
    return result;
  }

  /**
   * Cooperative shutdown. Aborts every active run, flags it as
   * `interrupted_graceful` so the next launch lands it in the recovery
   * UI cleanly, then awaits run-loop completion.
   */
  async gracefulShutdown(): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const [runId, handle] of this.activeRuns) {
      this.recoveryService.markGracefulShutdown(runId);
      handle.abort.abort("graceful-shutdown");
      pending.push(handle.done);
    }
    // Resolve any waiting gates so executors unblock before we await.
    for (const [key, pending2] of Array.from(this.pendingGates.entries())) {
      this.pendingGates.delete(key);
      pending2.resolve(false);
    }
    await Promise.allSettled(pending);
    log("gracefulShutdown complete; closed %d run(s)", pending.length);
  }

  // ── Executor wiring ────────────────────────────────────────────────

  private buildExecutorHooks(): StageExecutorHooks {
    return {
      onStageStart: async (runId, stage, branch) => {
        this.traceEmitter.emit({
          type: "stage.start",
          runId,
          timestamp: this.clock(),
          stageId: stage.id,
          branchIndex: branch.branchIndex,
        });
      },
      onStageEnd: async (runId, execution, stage) => {
        const durationMs = Math.max(
          0,
          (execution.completedAt ?? this.clock()) - (execution.startedAt ?? this.clock()),
        );
        this.traceEmitter.emit({
          type: "stage.end",
          runId,
          timestamp: this.clock(),
          stageId: execution.stageId,
          branchIndex: execution.branchIndex,
          status: execution.status,
          durationMs,
        });
        if (execution.error) {
          this.traceEmitter.emit({
            type: "stage.error",
            runId,
            timestamp: this.clock(),
            stageId: execution.stageId,
            branchIndex: execution.branchIndex,
            level: execution.error.level,
            message: execution.error.message,
          });
          this.errorStore.record({
            runId,
            stageId: execution.stageId,
            branchIndex: execution.branchIndex,
            level: execution.error.level,
            code: "stage-failure",
            message: execution.error.message,
            attempt: 1,
          });
        }
        this.persistExecution(runId, execution, stage);
        if (execution.status === "succeeded" && stage.userGate) {
          try {
            await this.waitForGate(runId, stage);
          } catch (err) {
            // Gate rejection: surface as a `failed` run so the user
            // knows execution stopped at their request, then abort so
            // downstream stages don't slip through. The
            // `executeRun` finally honours `failed` here (it would
            // otherwise overwrite with the executor's `cancelled`
            // verdict from the upcoming abort).
            const message = err instanceof Error ? err.message : String(err);
            const persisted = this.runStore.get(runId);
            if (persisted) {
              persisted.status = "failed";
              persisted.error = { level: "L1", message, stageId: stage.id };
              persisted.completedAt = this.clock();
              this.runStore.save(persisted);
            }
            this.activeRuns.get(runId)?.abort.abort("gate-rejected");
            throw err;
          }
        }
      },
      onProgress: (runId, stageId, branchIndex, detail) => {
        this.applyProgress(runId, stageId, branchIndex, detail);
      },
    };
  }

  private async executeRun(
    runId: string,
    template: PipelineTemplate,
    input: StartRunInput,
    abortCtl: AbortController,
    budget: BudgetTracker,
  ): Promise<void> {
    let final: Run | undefined;
    try {
      final = await this.stageExecutor.run({
        runId,
        template,
        cwd: input.cwd,
        variables: input.variables,
        projectId: input.projectId,
        abortSignal: abortCtl.signal,
      });
    } catch (err) {
      log("run failed runId=%s err=%o", runId, err);
      const message = err instanceof Error ? err.message : String(err);
      const fallback: Run = {
        ...(this.runStore.get(runId) ?? this.createRunRecord(runId, template, input)),
        status: "failed",
        completedAt: this.clock(),
        error: { level: "L3", message },
      };
      final = fallback;
    } finally {
      if (final) {
        // Carry over budgetUsage from the live tracker — the executor's
        // self-reported usage is stage-scoped; the budget tracker has the
        // run-scoped accumulation including out-of-band token reports.
        final.budgetUsage = budget.snapshot();
        if (final.budget === undefined && (input.budget ?? template.defaultBudget)) {
          final.budget = input.budget ?? template.defaultBudget;
        }
        // Honour any orchestrator-managed terminal status written
        // out-of-band before the executor unwound — graceful shutdown
        // (`interrupted_graceful`), unsafe-recovery flagging
        // (`interrupted_unsafe`), or gate rejection (`failed`). Without
        // this, the executor's own verdict (`cancelled` from the abort
        // path, or `completed` from a stage that succeeded after the
        // gate fix re-aborted) would clobber the user-visible status.
        const persisted = this.runStore.get(runId);
        if (
          persisted &&
          (persisted.status === "interrupted_graceful" ||
            persisted.status === "interrupted_unsafe" ||
            persisted.status === "failed")
        ) {
          final.status = persisted.status;
          if (persisted.error) final.error = persisted.error;
          if (persisted.completedAt !== undefined) final.completedAt = persisted.completedAt;
        }
        this.runStore.save(final);
        this.traceEmitter.emit({
          type: "run.end",
          runId,
          timestamp: this.clock(),
          status: final.status,
        });
      }
      this.activeRuns.delete(runId);
      this.changeTracker.clearRun(runId);
      this.subtaskTracker.clearRun(runId);
      // Drop in-memory subscribers so memory doesn't leak. Persisted
      // history remains queryable via TraceEmitter.history().
      this.traceEmitter.closeRun(runId);
    }
  }

  private persistExecution(
    runId: string,
    execution: import("../../../shared/features/agent-orchestrator/types").StageExecution,
    stage: StageNode,
  ): void {
    const run = this.runStore.get(runId);
    if (!run) return;
    const idx = run.executions.findIndex(
      (e) => e.stageId === execution.stageId && e.branchIndex === execution.branchIndex,
    );
    if (idx >= 0) run.executions[idx] = execution;
    else run.executions.push(execution);
    run.currentStageId = stage.id;
    this.runStore.save(run);
  }

  private applyProgress(
    runId: string,
    stageId: string,
    branchIndex: number,
    detail: ExecutorProgress,
  ): void {
    const handle = this.activeRuns.get(runId);
    if (!handle) return;
    if (detail.kind === "tokens") {
      const delta = (detail.deltaInput ?? 0) + (detail.deltaOutput ?? 0);
      if (delta > 0) handle.budget.consumeTokens(delta);
    }
    if (detail.kind === "file" && detail.action) {
      this.changeTracker.record({ runId, stageId, branchIndex }, detail.path, detail.action);
    }
  }

  private async waitForGate(runId: string, stage: StageNode): Promise<void> {
    const key = gateKey(runId, stage.id);
    let pending = this.pendingGates.get(key);
    if (!pending) {
      const promise = new Promise<boolean>((resolve) => {
        this.pendingGates.set(key, { resolve });
      });
      // Re-fetch after registration to satisfy TS narrowing.
      pending = this.pendingGates.get(key) ?? { resolve: () => {} };
      const run = this.runStore.get(runId);
      if (run && run.status === "running") {
        run.status = "paused_user_gate";
        run.currentStageId = stage.id;
        this.runStore.save(run);
      }
      this.traceEmitter.emit({
        type: "gate.requested",
        runId,
        timestamp: this.clock(),
        stageId: stage.id,
      });
      const approved = await promise;
      if (!approved) {
        throw new Error(`[orchestrator] gate rejected for stage ${stage.id}`);
      }
      const fresh = this.runStore.get(runId);
      if (fresh && fresh.status === "paused_user_gate") {
        fresh.status = "running";
        this.runStore.save(fresh);
      }
      return;
    }
    // Concurrent branch — just await the existing gate.
    const promise = new Promise<boolean>((resolve) => {
      const original = pending!.resolve;
      pending!.resolve = (approved) => {
        original(approved);
        resolve(approved);
      };
    });
    const approved = await promise;
    if (!approved) {
      throw new Error(`[orchestrator] gate rejected for stage ${stage.id}`);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private createRunRecord(runId: string, template: PipelineTemplate, input: StartRunInput): Run {
    const budget: Budget | undefined = input.budget ?? template.defaultBudget;
    return {
      id: runId,
      templateId: template.id,
      templateVersion: template.version,
      projectId: input.projectId,
      cwd: input.cwd,
      status: "running",
      startedAt: this.clock(),
      budget,
      budgetUsage: {
        usedTokens: 0,
        usedDurationMs: 0,
        usedCostUsd: 0,
        completedStages: 0,
      },
      executions: [],
    };
  }
}

/**
 * Build a `StageRegistry` populated with the four built-in ABCD stage
 * plugins. Tests can construct their own registry to inject custom
 * preambles or skip plugins entirely.
 */
export function buildDefaultStageRegistry(): StageRegistry {
  const registry = new StageRegistry();
  registry.register(architectStagePlugin);
  registry.register(reviewerStagePlugin);
  registry.register(implementerStagePlugin);
  registry.register(validatorStagePlugin);
  return registry;
}

function gateKey(runId: string, stageId: string): string {
  return `${runId}#${stageId}`;
}

/**
 * Convenience: register every executor required by the built-in
 * templates. Callers may register additional executors after this.
 */
export function registerBuiltinExecutors(
  registry: ExecutorRegistry,
  executors: Iterable<Executor>,
): void {
  for (const exec of executors) {
    if (!registry.has(exec.kind)) registry.register(exec);
  }
}

// Re-export the active run filter type so consumers don't need a
// second deep-import path.
export type { RunListFilter } from "./persistence/run-store";

// Sentinel re-export — lets tests import `RunStatus` from the façade
// without reaching into shared/types.
export type { RunStatus };
