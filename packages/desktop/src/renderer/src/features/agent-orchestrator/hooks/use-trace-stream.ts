/**
 * useTraceStream — derived view over the trace events that
 * `useRunSubscription` has already drained into the store.
 *
 * Wave 3.4 step 4.2 keeps this thin: filtering and de-duplication live in
 * the renderer because the store is the single buffer for live events.
 * The hook only handles type-chip filtering and a `paused` flag — the
 * underlying buffer continues to grow regardless of the view filter so
 * that resuming "play" yields the events that arrived during the pause.
 */

import { useMemo } from "react";

import type {
  TraceEvent,
  TraceEventType,
} from "../../../../../shared/features/agent-orchestrator/types";

import { useOrchestratorStore } from "../store";

export type TraceCategory = "run" | "stage" | "gate" | "budget" | "fanout" | "recovery";

export const TRACE_CATEGORIES: readonly TraceCategory[] = [
  "run",
  "stage",
  "gate",
  "budget",
  "fanout",
  "recovery",
] as const;

export const TRACE_CATEGORY_LABEL: Record<TraceCategory, string> = {
  run: "Run",
  stage: "Stage",
  gate: "Gate",
  budget: "Budget",
  fanout: "Fan-out / Fan-in",
  recovery: "Recovery",
};

export function categoryOf(type: TraceEventType): TraceCategory {
  if (type.startsWith("run.")) return "run";
  if (type.startsWith("stage.")) return "stage";
  if (type.startsWith("gate.")) return "gate";
  if (type.startsWith("budget.")) return "budget";
  if (type.startsWith("fanout.") || type.startsWith("fanin.")) return "fanout";
  if (type.startsWith("recovery.")) return "recovery";
  // Exhaustive guard — defaults keep the row visible if a new category is added.
  return "run";
}

export interface UseTraceStreamOptions {
  enabled?: TraceCategory[];
}

export interface UseTraceStreamResult {
  events: TraceEvent[];
  totalCount: number;
}

/**
 * Selects events for `runId` filtered by the enabled categories, sorted
 * ascending by `seq` (the orchestrator already appends in order, but this
 * keeps the contract explicit if events arrive out-of-band on reconnect).
 */
export function useTraceStream(
  runId: string | null,
  options: UseTraceStreamOptions = {},
): UseTraceStreamResult {
  const eventsByRun = useOrchestratorStore((s) => s.eventsByRun);

  return useMemo(() => {
    if (!runId) return { events: [], totalCount: 0 };
    const all = eventsByRun[runId] ?? [];
    const enabled = options.enabled ?? TRACE_CATEGORIES;
    const enabledSet = new Set(enabled);
    const filtered = all.filter((event) => enabledSet.has(categoryOf(event.type)));
    return {
      events: filtered.slice().sort((a, b) => a.seq - b.seq),
      totalCount: all.length,
    };
  }, [runId, eventsByRun, options.enabled]);
}
