/**
 * Agent Orchestrator — StageExecutor.
 *
 * Tick-loop scheduler that walks a validated DAG, expanding fan-out
 * branches in parallel within a stage and progressing across stages
 * as their dependencies satisfy. The class itself is concerned only
 * with **dispatch** — concrete LLM/Claude-Code execution lives behind
 * the `Executor` interface (commit 2.1) and persistence/trace/budget
 * land in later commits via dependency injection.
 *
 * Design notes:
 *   • Pure-business core: no electron / no oRPC. The orchestrator
 *     facade (commit 2.5) wires this with main-only services.
 *   • Determinism: stage iteration order is template-declared
 *     (validator hands us a stable topological order).
 *   • Failure model: a stage failure is fatal to the run by default;
 *     `recovery/` (commit 2.2) introduces resume strategies on top.
 *   • Aborts: a single shared `ExecutorAbortSignal` is forked to all
 *     branches; the executor exits as soon as it observes the abort.
 */

import debug from "debug";

import type {
  PipelineTemplate,
  Run,
  RunStatus,
  StageExecution,
  StageNode,
  StageOutput,
  StageStatus,
} from "../../../shared/features/agent-orchestrator/types";
import type { ExecutorRegistry } from "./executors/registry";
import type { ExecutorContext, ExecutorInput } from "./executors/types";

import { buildStageMap, validateDagOrThrow, type DagValidationOk } from "./dag/dag-validator";
import { OrchestratorAbortController } from "./executors/types";
import { detectConflicts, type FanoutBranchOutput } from "./fanout/conflict-detector";
import { aggregate } from "./fanout/fanin-aggregator-registry";
import { expandFanout, type FanoutBranch } from "./fanout/fanout-expander";

const log = debug("neovate:orchestrator:executor");

export type StageExecutorDeps = {
  /** Resolves an executor instance per `StageNode.executor`. */
  registry: ExecutorRegistry;
  /**
   * Called as state changes — the orchestrator facade may persist
   * snapshots, push trace events, etc. Stub-friendly: missing hooks
   * are silently ignored.
   */
  hooks?: StageExecutorHooks;
};

export type StageExecutorHooks = {
  onRunStart?(run: Run): void | Promise<void>;
  onStageStart?(runId: string, stage: StageNode, branch: FanoutBranch): void | Promise<void>;
  onStageEnd?(runId: string, execution: StageExecution, stage: StageNode): void | Promise<void>;
  onRunEnd?(run: Run): void | Promise<void>;
  /** Branch progress — token / file / log events from executors. */
  onProgress?(
    runId: string,
    stageId: string,
    branchIndex: number,
    detail: import("./executors/types").ExecutorProgress,
  ): void;
};

export type StartRunArgs = {
  runId: string;
  template: PipelineTemplate;
  cwd: string;
  /** Free-form variables interpolated into stage prompts. */
  variables?: Record<string, string>;
  projectId?: string;
  /** External cancel surface — observed each tick. */
  abortSignal?: AbortSignal;
};

export class StageExecutor {
  constructor(private readonly deps: StageExecutorDeps) {}

  /**
   * Run a pipeline template to completion. Resolves with the final
   * Run record (status `completed` / `failed` / `cancelled`).
   */
  async run(args: StartRunArgs): Promise<Run> {
    const validation = validateDagOrThrow(args.template);
    const stageMap = buildStageMap(args.template.stages);
    const startedAt = Date.now();

    const state: RunState = {
      runId: args.runId,
      template: args.template,
      cwd: args.cwd,
      variables: args.variables ?? {},
      projectId: args.projectId,
      validation,
      stageMap,
      stageStatus: new Map<string, StageStatus>(),
      stageOutputs: new Map<string, StageOutput>(),
      branchOutputs: new Map<string, StageOutput>(),
      executions: [],
      currentStageId: undefined,
      runStatus: "running",
      startedAt,
      runError: undefined,
      stageControllers: new Set<OrchestratorAbortController>(),
    };
    for (const stage of args.template.stages) {
      state.stageStatus.set(stage.id, "pending");
    }

    const initialRun = buildRun(state);
    await invoke(this.deps.hooks?.onRunStart, initialRun);

    const externalAbort = args.abortSignal;
    if (externalAbort?.aborted) {
      return finishRun(state, "cancelled", { externalAborted: true });
    }

    const cancelOnExternalAbort = () => {
      if (state.runStatus !== "running") return;
      state.runStatus = "cancelled";
      log("external abort triggered runId=%s", args.runId);
      // Propagate to live stage controllers so executors observe and bail.
      for (const controller of state.stageControllers) {
        controller.abort("external-abort");
      }
    };
    externalAbort?.addEventListener("abort", cancelOnExternalAbort);

    try {
      await this.tickLoop(state, externalAbort);
    } catch (err) {
      state.runStatus = "failed";
      state.runError = {
        level: "L3",
        message: err instanceof Error ? err.message : String(err),
      };
      log("run failed runId=%s err=%o", args.runId, err);
    } finally {
      externalAbort?.removeEventListener("abort", cancelOnExternalAbort);
    }

    return finishRun(state, state.runStatus);
  }

  private async tickLoop(state: RunState, externalAbort?: AbortSignal): Promise<void> {
    const inFlight = new Set<Promise<void>>();

    while (true) {
      if (
        externalAbort?.aborted ||
        state.runStatus === "cancelled" ||
        state.runStatus === "failed"
      ) {
        // Wait for already-dispatched branches to settle so we don't
        // leak executors. The branches themselves should observe the
        // shared abort and bail quickly.
        if (inFlight.size > 0) {
          await Promise.allSettled(Array.from(inFlight));
        }
        break;
      }

      // Find stages whose dependencies have all succeeded.
      const ready: StageNode[] = [];
      for (const stageId of state.validation.order) {
        if (state.stageStatus.get(stageId) !== "pending") continue;
        const stage = state.stageMap.get(stageId);
        if (!stage) continue;
        const depsReady = stage.dependsOn.every((d) => state.stageStatus.get(d) === "succeeded");
        if (depsReady) ready.push(stage);
      }

      // Termination: nothing in-flight and no new work.
      if (ready.length === 0 && inFlight.size === 0) {
        // If any stage is still pending, propagate cancellation.
        let unfinished = false;
        for (const status of state.stageStatus.values()) {
          if (status === "pending" || status === "running") unfinished = true;
        }
        if (!unfinished && state.runStatus === "running") {
          state.runStatus = "completed";
        }
        break;
      }

      // Activate ready stages.
      for (const stage of ready) {
        state.stageStatus.set(stage.id, "running");
        state.currentStageId = stage.id;
        const promise = this.runStage(state, stage).finally(() => inFlight.delete(promise));
        inFlight.add(promise);
      }

      if (inFlight.size > 0) {
        await Promise.race(inFlight);
      }
    }
  }

  private async runStage(state: RunState, stage: StageNode): Promise<void> {
    const branches = expandFanoutForStage(stage, state);
    if (branches.length === 0) {
      // Empty fan-out → mark skipped so downstream still gates on it.
      const execution: StageExecution = {
        stageId: stage.id,
        branchIndex: 0,
        status: "skipped",
        startedAt: Date.now(),
        completedAt: Date.now(),
      };
      state.executions.push(execution);
      state.stageStatus.set(stage.id, "succeeded");
      state.stageOutputs.set(stage.id, { payload: undefined, changedFiles: [] });
      await invoke(this.deps.hooks?.onStageEnd, state.runId, execution, stage);
      return;
    }

    const stageController = new OrchestratorAbortController();
    state.stageControllers.add(stageController);
    const branchResults: FanoutBranchOutput[] = [];
    let branchFailure:
      | {
          level: import("../../../shared/features/agent-orchestrator/types").ErrorLevel;
          message: string;
        }
      | undefined;

    try {
      await Promise.all(
        branches.map(async (branch) => {
          const startedAt = Date.now();
          try {
            await invoke(this.deps.hooks?.onStageStart, state.runId, stage, branch);
            const executor = this.deps.registry.resolve(stage.executor);
            const ctx: ExecutorContext = {
              emitProgress: (detail) => {
                this.deps.hooks?.onProgress?.(state.runId, stage.id, branch.branchIndex, detail);
              },
            };
            const input = buildExecutorInput({
              state,
              stage,
              branch,
              signal: stageController.signal,
            });
            const result = await executor.execute(input, ctx);
            const execution: StageExecution = {
              stageId: stage.id,
              branchIndex: branch.branchIndex,
              status: "succeeded",
              startedAt,
              completedAt: Date.now(),
              output: result.output,
              usage: result.usage,
            };
            state.executions.push(execution);
            state.branchOutputs.set(executionKey(stage.id, branch.branchIndex), result.output);
            branchResults.push({ branchIndex: branch.branchIndex, output: result.output });
            await invoke(this.deps.hooks?.onStageEnd, state.runId, execution, stage);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // If the run is already cancelling (external abort), treat the
            // executor rejection as a clean cancellation rather than a
            // surprise failure. This keeps `run.status === "cancelled"`.
            const cancelled = state.runStatus === "cancelled" || stageController.signal.aborted;
            const status: StageStatus = cancelled ? "cancelled" : "failed";
            const execution: StageExecution = {
              stageId: stage.id,
              branchIndex: branch.branchIndex,
              status,
              startedAt,
              completedAt: Date.now(),
              error: { level: cancelled ? "L1" : "L3", message },
            };
            state.executions.push(execution);
            if (!cancelled) {
              if (!branchFailure) branchFailure = { level: "L3", message };
              stageController.abort("branch-failure");
            }
            await invoke(this.deps.hooks?.onStageEnd, state.runId, execution, stage);
          }
        }),
      );
    } finally {
      state.stageControllers.delete(stageController);
    }

    if (state.runStatus === "cancelled") {
      state.stageStatus.set(stage.id, "cancelled");
      return;
    }

    if (branchFailure) {
      state.stageStatus.set(stage.id, "failed");
      state.runStatus = "failed";
      state.runError = { ...branchFailure, stageId: stage.id };
      return;
    }

    // Conflict detection — if multiple branches wrote the same file
    // we surface as a non-fatal warning (commit 2.4 will route this
    // through the trace emitter as a `stage.error` of level L2).
    if (branches.length > 1) {
      const report = detectConflicts(branchResults);
      if (report.conflicts.length > 0) {
        log(
          "fan-out conflicts runId=%s stage=%s conflicts=%o",
          state.runId,
          stage.id,
          report.conflicts.map((c) => c.path),
        );
      }
    }

    // Aggregate to stage-level output.
    const aggregated = aggregate(undefined, branchResults);
    state.stageOutputs.set(stage.id, aggregated);
    state.stageStatus.set(stage.id, "succeeded");
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

type RunState = {
  runId: string;
  template: PipelineTemplate;
  cwd: string;
  variables: Record<string, string>;
  projectId?: string;
  validation: DagValidationOk;
  stageMap: ReadonlyMap<string, StageNode>;
  stageStatus: Map<string, StageStatus>;
  stageOutputs: Map<string, StageOutput>;
  branchOutputs: Map<string, StageOutput>;
  executions: StageExecution[];
  currentStageId?: string;
  runStatus: RunStatus;
  startedAt: number;
  runError?: {
    level: import("../../../shared/features/agent-orchestrator/types").ErrorLevel;
    message: string;
    stageId?: string;
  };
  /** Live per-stage controllers, so external abort can fan out promptly. */
  stageControllers: Set<OrchestratorAbortController>;
};

function executionKey(stageId: string, branchIndex: number): string {
  return `${stageId}#${branchIndex}`;
}

function expandFanoutForStage(stage: StageNode, state: RunState): FanoutBranch[] {
  return expandFanout(stage, {
    upstreamOutputs: state.branchOutputs,
    defaultSourceStageId: stage.dependsOn[0],
  });
}

function buildExecutorInput(args: {
  state: RunState;
  stage: StageNode;
  branch: FanoutBranch;
  signal: import("./executors/types").ExecutorAbortSignal;
}): ExecutorInput {
  const { state, stage, branch, signal } = args;
  const upstreamOutputs: Record<string, StageOutput> = {};
  for (const [key, output] of state.branchOutputs) upstreamOutputs[key] = output;

  const mergedVars: Record<string, string> = { ...state.variables, ...branch.vars };
  const prompt = interpolateTemplate(stage.prompt, mergedVars);

  return {
    runId: state.runId,
    stage,
    branchIndex: branch.branchIndex,
    cwd: state.cwd,
    prompt,
    signal,
    upstreamOutputs,
    stageBudget: stage.budget,
  };
}

/**
 * `{{var}}` substitution. Missing keys leave the placeholder intact —
 * the executor sees the unresolved tag and may decide to abort
 * (acceptable for now; commit 2.4 will surface `unresolved-template`
 * as an L1 warning event).
 */
export function interpolateTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (full, key: string) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key]! : full;
  });
}

function buildRun(state: RunState): Run {
  return {
    id: state.runId,
    templateId: state.template.id,
    templateVersion: state.template.version,
    projectId: state.projectId,
    cwd: state.cwd,
    status: state.runStatus,
    currentStageId: state.currentStageId,
    startedAt: state.startedAt,
    completedAt: state.runStatus === "running" ? undefined : Date.now(),
    budgetUsage: aggregateBudgetUsage(state.executions),
    executions: [...state.executions],
    error: state.runError,
  };
}

function aggregateBudgetUsage(executions: StageExecution[]): {
  usedTokens: number;
  usedDurationMs: number;
  usedCostUsd: number;
  completedStages: number;
} {
  let usedTokens = 0;
  let usedDurationMs = 0;
  let usedCostUsd = 0;
  let completedStages = 0;
  for (const exec of executions) {
    if (!exec.usage) continue;
    usedTokens += exec.usage.usedTokens ?? 0;
    usedDurationMs += exec.usage.usedDurationMs ?? 0;
    usedCostUsd += exec.usage.usedCostUsd ?? 0;
    completedStages += exec.usage.completedStages ?? 0;
  }
  return { usedTokens, usedDurationMs, usedCostUsd, completedStages };
}

async function finishRun(
  state: RunState,
  finalStatus: RunStatus,
  opts: { externalAborted?: boolean } = {},
): Promise<Run> {
  state.runStatus = finalStatus;
  if (opts.externalAborted) {
    state.runStatus = "cancelled";
  }
  const run = buildRun(state);
  return run;
}

async function invoke<T extends (...args: never[]) => unknown>(
  fn: T | undefined,
  ...args: Parameters<T>
): Promise<void> {
  if (!fn) return;
  try {
    await fn(...args);
  } catch (err) {
    log("hook error: %o", err);
  }
}
