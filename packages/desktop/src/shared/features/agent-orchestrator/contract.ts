/**
 * Agent Orchestrator — oRPC contract.
 *
 * Wave 3.1 contract surface:
 *   listTemplates / startRun / getRun / listRuns / cancelRun
 *   listRecoverableRuns / resumeRunWithStrategy / approveGate
 *   subscribeRun / subscribeAll                (eventIterator)
 *   listCheckpoints
 *
 * The renderer reaches handlers via `client.agent.orchestrator.<leaf>`
 * after `shared/contract.ts` is rewired in this same commit. The main
 * implementation lands in Wave 3.2 commit 2.5.
 */

import { eventIterator, oc, type } from "@orpc/contract";
import { z } from "zod";

import type {
  Checkpoint,
  PipelineTemplate,
  RecoverableRun,
  Run,
  RunSummary,
  TraceEvent,
} from "./types";

import { budgetSchema, resumeStrategySchema, runStatusSchema } from "./schemas";

export const orchestratorContract = {
  /** List built-in + user pipeline templates available to start. */
  listTemplates: oc.input(z.object({})).output(type<PipelineTemplate[]>()),

  /**
   * Kick off a new run. Returns the persisted Run once the orchestrator
   * has accepted the request — actual stage execution streams via
   * `subscribeRun`.
   */
  startRun: oc
    .input(
      z.object({
        templateId: z.string().min(1),
        cwd: z.string().min(1),
        variables: z.record(z.string(), z.string()).optional(),
        budget: budgetSchema.optional(),
        projectId: z.string().optional(),
      }),
    )
    .output(type<Run>()),

  /** Get the full Run record (including stage executions). */
  getRun: oc.input(z.object({ runId: z.string().min(1) })).output(type<Run | null>()),

  /** List runs (sidebar / dashboard). Filters are best-effort. */
  listRuns: oc
    .input(
      z
        .object({
          projectId: z.string().optional(),
          status: z.array(runStatusSchema).optional(),
          limit: z.number().int().positive().max(500).optional(),
        })
        .optional(),
    )
    .output(type<RunSummary[]>()),

  /** Cancel an in-flight run. Idempotent. */
  cancelRun: oc
    .input(
      z.object({
        runId: z.string().min(1),
        reason: z.string().optional(),
      }),
    )
    .output(type<{ cancelled: boolean }>()),

  /** Runs that can be resumed after an interrupt (graceful or unsafe). */
  listRecoverableRuns: oc.input(z.object({})).output(type<RecoverableRun[]>()),

  /** Re-enter an interrupted run with a chosen strategy. */
  resumeRunWithStrategy: oc
    .input(
      z.object({
        runId: z.string().min(1),
        strategy: resumeStrategySchema,
        /** Optional re-prompt to inject when restarting a stage. */
        note: z.string().optional(),
      }),
    )
    .output(type<Run>()),

  /** User decision for a stage paused at a `userGate`. */
  approveGate: oc
    .input(
      z.object({
        runId: z.string().min(1),
        stageId: z.string().min(1),
        approved: z.boolean(),
        note: z.string().optional(),
      }),
    )
    .output(type<{ accepted: boolean }>()),

  /** Stream trace events for a single run. */
  subscribeRun: oc.input(type<{ runId: string }>()).output(eventIterator(type<TraceEvent>())),

  /** Stream trace events across all runs (dashboard view). */
  subscribeAll: oc.input(type<{ projectId?: string }>()).output(eventIterator(type<TraceEvent>())),

  /** List checkpoint records for a run (debug / recovery UI). */
  listCheckpoints: oc.input(z.object({ runId: z.string().min(1) })).output(type<Checkpoint[]>()),
};
