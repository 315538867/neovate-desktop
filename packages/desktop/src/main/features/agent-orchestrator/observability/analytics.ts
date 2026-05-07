/**
 * Agent Orchestrator — Analytics derivations.
 *
 * Pure functions over a list of `TraceEvent[]` (typically the output of
 * `EventStore.list(runId)`). The orchestrator façade calls these to
 * power the `getRun` summary, the trace pane charts, and post-mortem
 * dashboards. No persistence, no side effects.
 */

import type { TraceEvent } from "../../../../shared/features/agent-orchestrator/types";

export type StageDuration = {
  stageId: string;
  branchIndex: number;
  status: "succeeded" | "failed" | "skipped" | "cancelled";
  durationMs: number;
};

export type RunMetrics = {
  startedAt: number | undefined;
  endedAt: number | undefined;
  durationMs: number;
  stageStarts: number;
  stageEnds: number;
  errors: number;
  gateRequests: number;
  gateApprovals: number;
  fanoutBranches: number;
  budgetBreaches: number;
  recoveries: number;
};

const STAGE_KEY = (stageId: string, branchIndex: number) => `${stageId}#${branchIndex}`;

export function computeRunMetrics(events: ReadonlyArray<TraceEvent>): RunMetrics {
  const metrics: RunMetrics = {
    startedAt: undefined,
    endedAt: undefined,
    durationMs: 0,
    stageStarts: 0,
    stageEnds: 0,
    errors: 0,
    gateRequests: 0,
    gateApprovals: 0,
    fanoutBranches: 0,
    budgetBreaches: 0,
    recoveries: 0,
  };
  for (const event of events) {
    switch (event.type) {
      case "run.start":
        metrics.startedAt = event.timestamp;
        break;
      case "run.end":
      case "run.cancel":
        metrics.endedAt = event.timestamp;
        break;
      case "stage.start":
        metrics.stageStarts++;
        break;
      case "stage.end":
        metrics.stageEnds++;
        break;
      case "stage.error":
        metrics.errors++;
        break;
      case "gate.requested":
        metrics.gateRequests++;
        break;
      case "gate.resolved":
        if (event.approved) metrics.gateApprovals++;
        break;
      case "fanout.expanded":
        metrics.fanoutBranches += event.branches;
        break;
      case "budget.exceeded":
        metrics.budgetBreaches++;
        break;
      case "recovery.detected":
      case "recovery.resumed":
        metrics.recoveries++;
        break;
      default:
        break;
    }
  }
  if (metrics.startedAt !== undefined && metrics.endedAt !== undefined) {
    metrics.durationMs = Math.max(0, metrics.endedAt - metrics.startedAt);
  }
  return metrics;
}

export function stageDurations(events: ReadonlyArray<TraceEvent>): StageDuration[] {
  const startTimes = new Map<string, number>();
  const result: StageDuration[] = [];
  for (const event of events) {
    if (event.type === "stage.start") {
      startTimes.set(STAGE_KEY(event.stageId, event.branchIndex), event.timestamp);
    } else if (event.type === "stage.end") {
      const key = STAGE_KEY(event.stageId, event.branchIndex);
      const startedAt = startTimes.get(key);
      let durationMs = event.durationMs;
      if (!durationMs && startedAt !== undefined) {
        durationMs = event.timestamp - startedAt;
      }
      startTimes.delete(key);
      result.push({
        stageId: event.stageId,
        branchIndex: event.branchIndex,
        status: event.status as StageDuration["status"],
        durationMs: Math.max(0, durationMs ?? 0),
      });
    }
  }
  return result;
}

export function topSlowStages(events: ReadonlyArray<TraceEvent>, limit = 5): StageDuration[] {
  return stageDurations(events)
    .slice()
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, Math.max(0, limit));
}
