/**
 * Agent Orchestrator — Zod 4 schemas (shared between main & renderer).
 *
 * Defines the wire-level shape of pipeline templates, run state, budget
 * envelopes, trace events, and checkpoint records. The runtime types live
 * in `./types.ts` (derived via `z.infer`); the oRPC contract in
 * `./contract.ts`. Executor wiring (interfaces consumed by the
 * orchestrator at runtime) is in `./executor-types.ts`.
 *
 * Wave 3.1 — minimal but complete shape so Wave 3.2 implementations can
 * plug in without contract churn. Schema additions are non-breaking;
 * removals/renames must follow the same explicit-migration discipline as
 * the agent.session.* split.
 */

import { z } from "zod";

// ── Core enums ──────────────────────────────────────────────────────

/** ABCD pipeline roles. `custom` allows user-supplied stage kinds. */
export const stageKindSchema = z.enum([
  "architect",
  "reviewer",
  "implementer",
  "validator",
  "custom",
]);

/**
 * Executor selection per stage. `llm-only` runs raw chat completions;
 * `claude-code` delegates to the Claude Agent SDK via SessionManager.
 */
export const executorKindSchema = z.enum(["llm-only", "claude-code"]);

/**
 * Run lifecycle. `interrupted_graceful` = process exited cleanly
 * (`gracefulShutdown` ran); `interrupted_unsafe` = inferred at startup
 * when a `running` row was found without graceful exit.
 */
export const runStatusSchema = z.enum([
  "pending",
  "running",
  "paused_user_gate",
  "completed",
  "failed",
  "cancelled",
  "interrupted_graceful",
  "interrupted_unsafe",
]);

export const stageStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
]);

/** Resume strategy when re-entering an interrupted run. */
export const resumeStrategySchema = z.enum([
  "resume_from_checkpoint",
  "restart_failed_stage",
  "skip_failed_stage",
  "abort",
]);

/**
 * Error severity ladder (L0 transient retry → L4 fatal/no recovery).
 * Mirrors `errors/error-classifier.ts` — kept here so the renderer can
 * render badges without import-crossing the process boundary.
 */
export const errorLevelSchema = z.enum(["L0", "L1", "L2", "L3", "L4"]);

// ── Budget envelopes ────────────────────────────────────────────────

/**
 * Per-run / per-stage caps. Any field omitted means "no cap on this
 * dimension". Concurrency / timeout / heartbeat live elsewhere — this
 * schema is the user-visible budget surface only.
 */
export const budgetSchema = z.object({
  maxTokens: z.number().int().nonnegative().optional(),
  maxDurationMs: z.number().int().nonnegative().optional(),
  maxCostUsd: z.number().nonnegative().optional(),
  maxStages: z.number().int().nonnegative().optional(),
});

export const budgetUsageSchema = z.object({
  usedTokens: z.number().int().nonnegative().default(0),
  usedDurationMs: z.number().int().nonnegative().default(0),
  usedCostUsd: z.number().nonnegative().default(0),
  completedStages: z.number().int().nonnegative().default(0),
});

// ── Fan-out / sandbox ───────────────────────────────────────────────

/**
 * Fan-out spec for a stage. `kind: "static"` expands to a fixed list of
 * variants; `kind: "input"` expands at runtime from the upstream
 * stage's structured output (key path resolved by the executor).
 */
export const fanoutSpecSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("static"),
    variants: z.array(z.string()).min(1),
  }),
  z.object({
    kind: z.literal("input"),
    /** Dot-path into the producer stage's `output.payload`. */
    path: z.string(),
    /** Hard cap to prevent runaway expansion. */
    maxBranches: z.number().int().positive().default(8),
  }),
]);

export const sandboxSpecSchema = z.object({
  /** Use a git worktree for isolation. */
  worktree: z.boolean().default(false),
  /** Branch name template (supports `{runId}` / `{stageId}` tokens). */
  branchTemplate: z.string().optional(),
});

// ── Stage / template ────────────────────────────────────────────────

export const stageNodeSchema = z.object({
  id: z.string().min(1),
  kind: stageKindSchema,
  executor: executorKindSchema,
  /** Stage IDs whose successful completion gates this one. */
  dependsOn: z.array(z.string()).default([]),
  /** User-facing label; falls back to `id` in UI. */
  label: z.string().optional(),
  /** Prompt template — `{{var}}` interpolation handled by the runtime. */
  prompt: z.string(),
  /** Provider-qualified model id (e.g. `anthropic/claude-sonnet-4-6`). */
  model: z.string().optional(),
  /** Per-stage budget override (run budget still applies as outer cap). */
  budget: budgetSchema.optional(),
  sandbox: sandboxSpecSchema.optional(),
  fanout: fanoutSpecSchema.optional(),
  /**
   * If true, completion blocks on user approval before the next stage
   * starts. Resolved via `approveGate`.
   */
  userGate: z.boolean().default(false),
});

export const pipelineTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  /** Semver-style version. Templates are immutable per version. */
  version: z.string().min(1),
  stages: z.array(stageNodeSchema).min(1),
  /** Default budget if a run does not provide one. */
  defaultBudget: budgetSchema.optional(),
  /** Built-in templates set this to `"builtin"` for UI badge filtering. */
  source: z.enum(["builtin", "user"]).default("user"),
});

// ── Run / stage execution records ───────────────────────────────────

export const stageOutputSchema = z.object({
  /** Free-form structured payload returned by the executor. */
  payload: z.unknown().optional(),
  /** Human-readable summary for the trace pane. */
  summary: z.string().optional(),
  /** ChangeTracker file deltas recorded during execution. */
  changedFiles: z.array(z.string()).default([]),
});

export const stageExecutionSchema = z.object({
  stageId: z.string(),
  /** Branch index for fan-out children; `0` for non-fanned stages. */
  branchIndex: z.number().int().nonnegative().default(0),
  status: stageStatusSchema,
  startedAt: z.number().int().optional(),
  completedAt: z.number().int().optional(),
  output: stageOutputSchema.optional(),
  error: z
    .object({
      level: errorLevelSchema,
      message: z.string(),
      stack: z.string().optional(),
      cause: z.string().optional(),
    })
    .optional(),
  /** Token / cost / duration consumed by this stage execution. */
  usage: budgetUsageSchema.optional(),
});

export const runSchema = z.object({
  id: z.string().min(1),
  templateId: z.string().min(1),
  templateVersion: z.string().min(1),
  projectId: z.string().optional(),
  cwd: z.string().min(1),
  status: runStatusSchema,
  /** Currently executing stage id (or last entered if interrupted). */
  currentStageId: z.string().optional(),
  startedAt: z.number().int(),
  completedAt: z.number().int().optional(),
  budget: budgetSchema.optional(),
  budgetUsage: budgetUsageSchema.default({
    usedTokens: 0,
    usedDurationMs: 0,
    usedCostUsd: 0,
    completedStages: 0,
  }),
  /** Stage execution rows keyed by `${stageId}#${branchIndex}`. */
  executions: z.array(stageExecutionSchema).default([]),
  /** Top-level error iff status === "failed". */
  error: z
    .object({
      level: errorLevelSchema,
      message: z.string(),
      stageId: z.string().optional(),
    })
    .optional(),
});

/** Subset returned by `listRuns` — full executions stay in `getRun`. */
export const runSummarySchema = runSchema
  .pick({
    id: true,
    templateId: true,
    templateVersion: true,
    projectId: true,
    cwd: true,
    status: true,
    currentStageId: true,
    startedAt: true,
    completedAt: true,
    budgetUsage: true,
  })
  .extend({
    /** Number of stage executions completed (including fan-out children). */
    completedStageCount: z.number().int().nonnegative().default(0),
    /** Total stage executions expected (post fan-out expansion if known). */
    totalStageCount: z.number().int().nonnegative().default(0),
  });

// ── Trace events ────────────────────────────────────────────────────

const traceEventBase = z.object({
  /** Monotonic per-run sequence number. */
  seq: z.number().int().nonnegative(),
  runId: z.string(),
  timestamp: z.number().int(),
});

export const traceEventSchema = z.discriminatedUnion("type", [
  traceEventBase.extend({
    type: z.literal("run.start"),
    templateId: z.string(),
  }),
  traceEventBase.extend({
    type: z.literal("run.end"),
    status: runStatusSchema,
  }),
  traceEventBase.extend({
    type: z.literal("run.cancel"),
    reason: z.string().optional(),
  }),
  traceEventBase.extend({
    type: z.literal("stage.start"),
    stageId: z.string(),
    branchIndex: z.number().int().nonnegative().default(0),
  }),
  traceEventBase.extend({
    type: z.literal("stage.end"),
    stageId: z.string(),
    branchIndex: z.number().int().nonnegative().default(0),
    status: stageStatusSchema,
    durationMs: z.number().int().nonnegative(),
  }),
  traceEventBase.extend({
    type: z.literal("stage.error"),
    stageId: z.string(),
    branchIndex: z.number().int().nonnegative().default(0),
    level: errorLevelSchema,
    message: z.string(),
  }),
  traceEventBase.extend({
    type: z.literal("gate.requested"),
    stageId: z.string(),
  }),
  traceEventBase.extend({
    type: z.literal("gate.resolved"),
    stageId: z.string(),
    approved: z.boolean(),
  }),
  traceEventBase.extend({
    type: z.literal("budget.exceeded"),
    dimension: z.enum(["tokens", "duration", "cost", "stages"]),
    usage: budgetUsageSchema,
  }),
  traceEventBase.extend({
    type: z.literal("fanout.expanded"),
    stageId: z.string(),
    branches: z.number().int().positive(),
  }),
  traceEventBase.extend({
    type: z.literal("fanin.aggregated"),
    stageId: z.string(),
    sourceCount: z.number().int().nonnegative(),
  }),
  traceEventBase.extend({
    type: z.literal("recovery.detected"),
    /** The status the run was found in at startup. */
    foundStatus: runStatusSchema,
  }),
  traceEventBase.extend({
    type: z.literal("recovery.resumed"),
    strategy: resumeStrategySchema,
  }),
]);

// ── Checkpoint ──────────────────────────────────────────────────────

export const checkpointSchema = z.object({
  id: z.string(),
  runId: z.string(),
  stageId: z.string(),
  branchIndex: z.number().int().nonnegative().default(0),
  persistedAt: z.number().int(),
  /** Opaque executor-defined snapshot used to resume. */
  payload: z.unknown(),
});

// ── Recovery descriptor ─────────────────────────────────────────────

export const recoverableRunSchema = z.object({
  runId: z.string(),
  templateId: z.string(),
  cwd: z.string(),
  lastStatus: runStatusSchema,
  lastStageId: z.string().optional(),
  hasCheckpoint: z.boolean(),
  /** Best-effort sandbox path if a worktree was created. */
  sandboxPath: z.string().optional(),
  interruptedAt: z.number().int(),
});
