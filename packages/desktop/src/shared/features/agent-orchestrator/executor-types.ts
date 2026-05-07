/**
 * Agent Orchestrator — Executor interface.
 *
 * Wave 3.1 contract surface for what an "executor" must look like, so
 * the orchestrator (Wave 3.2 commit 2.1) can plug in `LlmOnlyExecutor`
 * and `ClaudeCodeExecutor` behind a single dispatch.
 *
 * NOTE: This file holds *interface-only* types. Concrete executor
 * implementations live under `src/main/features/agent-orchestrator/
 * executors/` and depend on main-only services (SessionManager,
 * RequestTracker, …) — they MUST NOT be imported from renderer code.
 */

import type { Budget, BudgetUsage, ExecutorKind, StageNode, StageOutput } from "./types";

/**
 * Cancellation surface for an in-flight executor invocation. Mirrors
 * `AbortSignal` so callers can reuse standard plumbing (fetch, etc.).
 */
export type ExecutorAbortSignal = {
  readonly aborted: boolean;
  /**
   * Reason for abort:
   *   - "budget" → run/stage exceeded budget cap
   *   - "user"   → renderer-initiated cancel
   *   - "shutdown" → main process shutting down (graceful)
   *   - "timeout" → stage timeout fired
   */
  readonly reason?: "budget" | "user" | "shutdown" | "timeout" | string;
  addEventListener(type: "abort", listener: () => void): void;
  removeEventListener(type: "abort", listener: () => void): void;
};

/**
 * Variables interpolated into the stage prompt. Resolved by the
 * orchestrator from upstream stage outputs + user-supplied vars.
 */
export type ExecutorPromptVariables = Record<string, string>;

/**
 * Per-call input to an executor. The orchestrator owns assembly of
 * this object — executors never read user state directly.
 */
export type ExecutorInput = {
  runId: string;
  stage: StageNode;
  branchIndex: number;
  /** Resolved working directory (may be a sandbox worktree path). */
  cwd: string;
  /** Already-rendered prompt (no further interpolation needed). */
  prompt: string;
  /** Budget remaining at call time (caller copy; not authoritative). */
  budgetRemaining?: Budget;
  /** Stage-level budget override if the template supplied one. */
  stageBudget?: Budget;
  /** Cancellation channel — executors must observe this. */
  signal: ExecutorAbortSignal;
  /** Resolved upstream stage outputs keyed by `${stageId}#${branch}`. */
  upstreamOutputs?: Record<string, StageOutput>;
};

/**
 * Per-call output from an executor. `usage` is consumed by the
 * BudgetTracker; `output` is forwarded to downstream stages.
 */
export type ExecutorResult = {
  output: StageOutput;
  usage: BudgetUsage;
};

/**
 * Lifecycle handle for streaming intermediate events back to the
 * orchestrator's TraceEmitter (commit 2.4). Executors should call
 * `emitProgress` for token / tool / file deltas; final result is
 * returned via the resolved promise.
 */
export type ExecutorContext = {
  emitProgress(detail: ExecutorProgress): void;
};

export type ExecutorProgress =
  | { kind: "tokens"; deltaInput?: number; deltaOutput?: number }
  | { kind: "tool"; name: string }
  | { kind: "file"; path: string; action: "read" | "write" | "delete" }
  | { kind: "log"; level: "info" | "warn" | "error"; message: string };

/**
 * The executor contract itself. Each implementation declares the
 * `kind` it handles; the registry dispatches by stage.executor.
 */
export interface Executor {
  readonly kind: ExecutorKind;
  execute(input: ExecutorInput, ctx: ExecutorContext): Promise<ExecutorResult>;
}
