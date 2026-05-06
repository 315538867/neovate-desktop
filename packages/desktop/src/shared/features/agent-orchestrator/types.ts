/**
 * Agent Orchestrator — derived TypeScript types.
 *
 * Pure type re-exports inferred from `./schemas.ts`. Importers should
 * pull types from here and avoid `z.infer<typeof ...>` at call sites
 * — keeping the inference centralised lets us change a schema without
 * sweeping the codebase for inferred-shape leaks.
 */

import type { z } from "zod";

import type {
  budgetSchema,
  budgetUsageSchema,
  checkpointSchema,
  errorLevelSchema,
  executorKindSchema,
  fanoutSpecSchema,
  pipelineTemplateSchema,
  recoverableRunSchema,
  resumeStrategySchema,
  runSchema,
  runStatusSchema,
  runSummarySchema,
  sandboxSpecSchema,
  stageExecutionSchema,
  stageKindSchema,
  stageNodeSchema,
  stageOutputSchema,
  stageStatusSchema,
  traceEventSchema,
} from "./schemas";

export type StageKind = z.infer<typeof stageKindSchema>;
export type ExecutorKind = z.infer<typeof executorKindSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type StageStatus = z.infer<typeof stageStatusSchema>;
export type ResumeStrategy = z.infer<typeof resumeStrategySchema>;
export type ErrorLevel = z.infer<typeof errorLevelSchema>;

export type Budget = z.infer<typeof budgetSchema>;
export type BudgetUsage = z.infer<typeof budgetUsageSchema>;

export type FanoutSpec = z.infer<typeof fanoutSpecSchema>;
export type SandboxSpec = z.infer<typeof sandboxSpecSchema>;

export type StageNode = z.infer<typeof stageNodeSchema>;
export type PipelineTemplate = z.infer<typeof pipelineTemplateSchema>;

export type StageOutput = z.infer<typeof stageOutputSchema>;
export type StageExecution = z.infer<typeof stageExecutionSchema>;
export type Run = z.infer<typeof runSchema>;
export type RunSummary = z.infer<typeof runSummarySchema>;

export type TraceEvent = z.infer<typeof traceEventSchema>;
export type TraceEventType = TraceEvent["type"];

export type Checkpoint = z.infer<typeof checkpointSchema>;
export type RecoverableRun = z.infer<typeof recoverableRunSchema>;

/**
 * `startRun` input shape — pulled out of the contract for re-use by
 * builders / template helpers in main.
 */
export type StartRunInput = {
  templateId: string;
  cwd: string;
  /** Free-form variables interpolated into stage prompts. */
  variables?: Record<string, string>;
  budget?: Budget;
  /** Project association for sidebar grouping. */
  projectId?: string;
};

/**
 * Approve-gate response from the user. `approved=false` aborts the run
 * unless `note` carries a re-prompt that the orchestrator re-injects
 * into the next attempt.
 */
export type GateDecision = {
  runId: string;
  stageId: string;
  approved: boolean;
  note?: string;
};
