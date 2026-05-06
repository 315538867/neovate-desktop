/**
 * Agent Orchestrator — Dashboard report builder.
 *
 * Aggregates a Run + its TraceEvent log into a serialisable report
 * shape consumed by the renderer's post-mortem panel. Pure function:
 * keep IO out of here.
 */

import type {
  Run,
  StageStatus,
  TraceEvent,
} from "../../../../shared/features/agent-orchestrator/types";

import {
  computeRunMetrics,
  stageDurations,
  topSlowStages,
  type RunMetrics,
  type StageDuration,
} from "./analytics";

export type DashboardReport = {
  run: {
    id: string;
    templateId: string;
    templateVersion: string;
    status: Run["status"];
    cwd: string;
    projectId?: string;
    budget?: Run["budget"];
    budgetUsage: Run["budgetUsage"];
  };
  metrics: RunMetrics;
  durations: StageDuration[];
  slowest: StageDuration[];
  failedStages: Array<{
    stageId: string;
    branchIndex: number;
    status: StageStatus;
    error?: { level: string; message: string };
  }>;
};

export function buildRunReport(
  run: Run,
  events: ReadonlyArray<TraceEvent>,
  options: { slowestLimit?: number } = {},
): DashboardReport {
  const failed = run.executions
    .filter((e) => e.status === "failed" || e.status === "cancelled")
    .map((e) => ({
      stageId: e.stageId,
      branchIndex: e.branchIndex,
      status: e.status,
      error: e.error ? { level: e.error.level, message: e.error.message } : undefined,
    }));

  return {
    run: {
      id: run.id,
      templateId: run.templateId,
      templateVersion: run.templateVersion,
      status: run.status,
      cwd: run.cwd,
      projectId: run.projectId,
      budget: run.budget,
      budgetUsage: run.budgetUsage,
    },
    metrics: computeRunMetrics(events),
    durations: stageDurations(events),
    slowest: topSlowStages(events, options.slowestLimit ?? 5),
    failedStages: failed,
  };
}
