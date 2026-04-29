import { z } from "zod";

// ============================================================
// 业务产物 Schemas
// ============================================================

export const TaskInputSchema = z.object({
  userPrompt: z.string(),
  workspacePath: z.string(),
  attachments: z.array(z.unknown()).optional(),
});
export type TaskInput = z.infer<typeof TaskInputSchema>;

export const ArchitectureDocSchema = z.object({
  goal: z.string(),
  approach: z.string(),
  modules: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      responsibility: z.string(),
      changes: z.enum(["create", "modify", "delete"]),
    }),
  ),
  interfaces: z.array(
    z.object({
      name: z.string(),
      signature: z.string(),
      rationale: z.string(),
    }),
  ),
  risks: z.array(z.string()),
  outOfScope: z.array(z.string()),
  estimatedSubtasks: z.array(z.string()),
  parallelizationHint: z
    .object({
      splitBy: z.enum(["module", "file", "none"]),
      splits: z.array(
        z.object({
          label: z.string(),
          moduleIndices: z.array(z.number().int().min(0)),
        }),
      ),
    })
    .optional(),
});
export type ArchitectureDoc = z.infer<typeof ArchitectureDocSchema>;

export const ReviewReportSchema = z.object({
  decision: z.enum(["approved", "rejected", "approved_with_concerns"]),
  score: z.number().min(0).max(10),
  issues: z.array(
    z.object({
      severity: z.enum(["blocker", "major", "minor"]),
      location: z.string(),
      problem: z.string(),
      suggestion: z.string(),
    }),
  ),
  strengths: z.array(z.string()),
});
export type ReviewReport = z.infer<typeof ReviewReportSchema>;

export const FileChangeSchema = z.object({
  path: z.string(),
  operation: z.enum(["create", "modify", "delete"]),
  beforeHash: z.string().optional(),
  afterHash: z.string().optional(),
  bytesAdded: z.number().int().min(0).optional(),
  bytesRemoved: z.number().int().min(0).optional(),
  source: z.enum(["tool-event", "baseline-diff"]),
  toolCallId: z.string().optional(),
  timestamp: z.string(),
});
export type FileChange = z.infer<typeof FileChangeSchema>;

export const SubtaskRecordSchema = z.object({
  taskId: z.string(),
  description: z.string(),
  status: z.enum(["running", "done", "failed", "skipped"]),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  retryCount: z.number().int().min(0).default(0),
  errorMessage: z.string().optional(),
  filesChanged: z.array(z.string()).default([]),
  parentStageInstanceId: z.string(),
});
export type SubtaskRecord = z.infer<typeof SubtaskRecordSchema>;

export const ImplementationResultSchema = z.object({
  status: z.enum(["success", "partial", "failed"]),
  filesChanged: z.array(FileChangeSchema),
  subtaskLog: z.array(SubtaskRecordSchema),
  unresolvedIssues: z.array(z.string()),
  summary: z.string(),
});
export type ImplementationResult = z.infer<typeof ImplementationResultSchema>;

export const AcceptanceReportSchema = z.object({
  decision: z.enum(["accepted", "rejected", "accepted_with_followups"]),
  score: z.number().min(0).max(10),
  defects: z.array(
    z.object({
      severity: z.enum(["blocker", "major", "minor"]),
      file: z.string().optional(),
      problem: z.string(),
      fixHint: z.string(),
    }),
  ),
  matchesArchitecture: z.boolean(),
  followups: z.array(z.string()),
});
export type AcceptanceReport = z.infer<typeof AcceptanceReportSchema>;

// ============================================================
// 编排核心 Schemas
// ============================================================

export const PipelineRunStatusSchema = z.enum([
  "init",
  "running",
  "awaiting_user",
  "paused",
  "completed",
  "failed",
  "cancelled",
  "interrupted_graceful",
  "interrupted_crashed",
  "stalled",
]);
export type PipelineRunStatus = z.infer<typeof PipelineRunStatusSchema>;

export const StageRunStatusSchema = z.enum([
  "pending",
  "running",
  "awaiting_user",
  "completed",
  "failed",
  "paused",
  "interrupted_graceful",
  "interrupted_crashed",
  "stalled",
  "skipped",
]);
export type StageRunStatus = z.infer<typeof StageRunStatusSchema>;

export const StageErrorSchema = z.object({
  attempt: z.number().int().min(0),
  timestamp: z.string(),
  level: z.enum(["L0", "L1", "L2", "L3", "L4"]),
  code: z.enum([
    "auth_failed",
    "invalid_request",
    "context_too_long",
    "content_policy",
    "rate_limit_exhausted",
    "network_failed",
    "output_parse_failed",
    "capability_mismatch",
    "budget_exceeded",
    "timeout",
    "unknown",
  ]),
  httpStatus: z.number().optional(),
  providerMessage: z.string().optional(),
  cause: z.string().optional(),
  retryAfter: z.number().int().optional(),
});
export type StageError = z.infer<typeof StageErrorSchema>;

export const StageCheckpointSchema = z.object({
  sessionId: z.string().optional(),
  sandboxPath: z.string(),
  sandboxBranch: z.string().optional(),
  sandboxValidationHash: z.string(),
  stageInputDigest: z.string(),
  startedAt: z.string(),
});
export type StageCheckpoint = z.infer<typeof StageCheckpointSchema>;

export const StageRunRecordSchema = z.object({
  instanceId: z.string(),
  stageId: z.string(),
  executorId: z.string(),
  status: StageRunStatusSchema,
  runtimeStatus: StageRunStatusSchema.optional(),
  input: z.unknown(),
  output: z.unknown().optional(),
  errors: z.array(StageErrorSchema).default([]),
  fatalError: StageErrorSchema.optional(),
  attempt: z.number().int().min(0).default(0),
  checkpoint: StageCheckpointSchema.optional(),
  partialOutput: z.unknown().optional(),
  pausedReason: z
    .enum(["user", "app_restart", "budget", "conflict", "project_switch", "stage_timeout"])
    .optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  fanOutParentInstanceId: z.string().optional(),
  fanOutIndex: z.number().int().min(0).optional(),
});
export type StageRunRecord = z.infer<typeof StageRunRecordSchema>;

export const PipelineBudgetSchema = z.object({
  maxTokens: z.number().int().positive().optional(),
  maxCost: z.number().positive().optional(),
  maxDurationMs: z.number().int().positive().optional(),
  usedTokens: z.number().int().min(0).default(0),
  usedCost: z.number().min(0).default(0),
  usedDurationMs: z.number().int().min(0).default(0),
});
export type PipelineBudget = z.infer<typeof PipelineBudgetSchema>;

export const PipelineRunSchema = z.object({
  runId: z.string(),
  templateId: z.string(),
  workspacePath: z.string(),
  userPrompt: z.string(),
  stageRuns: z.array(StageRunRecordSchema),
  status: PipelineRunStatusSchema,
  budget: PipelineBudgetSchema.optional(),
  executorMap: z.record(z.string(), z.string()),
  createdAt: z.string(),
  completedAt: z.string().optional(),
  pausedAt: z.string().optional(),
  failureReason: z.string().optional(),
  lastHeartbeatAt: z.string().optional(),
  ownerPid: z.number().int().optional(),
  ownerStartedAt: z.string().optional(),
});
export type PipelineRun = z.infer<typeof PipelineRunSchema>;

export const PipelineEventSchema = z.object({
  type: z.string(),
  timestamp: z.string(),
  runId: z.string(),
  stageInstanceId: z.string().optional(),
  payload: z.unknown(),
});
export type PipelineEvent = z.infer<typeof PipelineEventSchema>;

export const PipelineTemplateSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string(),
  stages: z.array(
    z.object({
      stageId: z.string(),
      instanceId: z.string(),
      dependsOn: z.array(z.string()).default([]),
      optional: z.boolean().default(false),
      userGate: z.enum(["before", "after", "never"]).default("after"),
      repeatCondition: z
        .enum(["on-failure", "on-user-request", "never"])
        .default("on-user-request"),
      maxRetries: z.number().int().min(0).default(2),
      timeoutMs: z.number().int().positive().optional(),
      fanOut: z
        .object({
          sourceField: z.string(),
          parallelism: z.number().int().min(1).default(3),
          condition: z.string().optional(),
          isolationStrategy: z
            .enum(["independent-sandbox", "shared-with-paths"])
            .default("independent-sandbox"),
        })
        .optional(),
      fanIn: z
        .object({
          aggregatorId: z.string(),
        })
        .optional(),
    }),
  ),
  defaultExecutorMap: z.record(z.string(), z.string()),
});
export type PipelineTemplate = z.infer<typeof PipelineTemplateSchema>;

// ============================================================
// 派生函数
// ============================================================

export function deriveRunStatus(
  stageRuns: Pick<PipelineRun, "stageRuns">["stageRuns"],
): PipelineRunStatus {
  if (stageRuns.length === 0) return "init";

  if (stageRuns.some((s) => s.status === "interrupted_crashed")) return "interrupted_crashed";
  if (stageRuns.some((s) => s.status === "interrupted_graceful")) return "interrupted_graceful";
  if (stageRuns.some((s) => s.status === "stalled")) return "stalled";

  if (stageRuns.some((s) => s.status === "failed" && (s.fatalError || s.attempt >= 99)))
    return "failed";
  if (stageRuns.some((s) => s.status === "awaiting_user")) return "awaiting_user";
  if (stageRuns.some((s) => s.status === "paused")) return "paused";
  if (stageRuns.some((s) => s.status === "running")) return "running";

  if (stageRuns.every((s) => s.status === "completed" || s.status === "skipped"))
    return "completed";
  return "init";
}
