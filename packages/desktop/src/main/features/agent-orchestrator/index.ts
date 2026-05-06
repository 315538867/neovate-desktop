/**
 * Agent Orchestrator — module barrel.
 *
 * Public surface used by `main/index.ts` (instantiation) and
 * `main/router.ts` (route mounting + AppContext typing). Internal
 * helpers are deliberately not re-exported to keep the seam narrow.
 *
 * Test files import directly from individual leaf modules to avoid
 * inflating the bundle that production consumers see.
 */

export { Orchestrator, buildDefaultStageRegistry, registerBuiltinExecutors } from "./orchestrator";
export type { OrchestratorDeps } from "./orchestrator";

export { orchestratorRouter } from "./router";

// Persistence stores — needed by main/index.ts wiring.
export { RunStore } from "./persistence/run-store";
export { EventStore } from "./persistence/event-store";
export { CheckpointManager } from "./persistence/checkpoint-manager";
export { PartialOutputStore } from "./persistence/partial-output-store";

// Errors / safety / observability primitives consumed at boot.
export { ErrorStore } from "./errors/error-store";
export { RetryPolicy } from "./errors/retry-policy";
export { TraceEmitter } from "./observability/trace";

// Executors + registry.
export { ExecutorRegistry } from "./executors/registry";
export { LlmOnlyExecutor } from "./executors/llm-only-executor";
export { ClaudeCodeExecutor } from "./executors/claude-code-executor";
export type { Executor, ExecutorContext, ExecutorResult } from "./executors/types";

// Sandbox / change tracker / subtask tracker.
export { WorktreeManager } from "./sandbox/worktree-manager";
export { ChangeTracker } from "./change-tracker";
export { SubtaskTracker } from "./subtasks/subtask-tracker";

// Templates: built-in registry seeding.
export { TemplateRegistry } from "./templates/registry";
export { loadTemplateRegistry, BUILTIN_TEMPLATES } from "./templates/loader";
export type { LoadOptions } from "./templates/loader";
