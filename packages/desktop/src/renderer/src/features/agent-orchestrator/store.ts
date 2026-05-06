/**
 * Agent Orchestrator — renderer store.
 *
 * Tracks pipeline runs, their summaries, the active run detail, and the
 * trace event timeline buffered per run. The store is intentionally
 * minimal: hooks (`use-runs`, `use-run-subscription`) push the canonical
 * state in here, and components are pure consumers.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import type {
  PipelineTemplate,
  Run,
  RunSummary,
  TraceEvent,
} from "../../../../shared/features/agent-orchestrator/types";

export type OrchestratorState = {
  /** Persisted slice toggling the standalone overlay panel. */
  showOrchestrator: boolean;
  templates: PipelineTemplate[];
  /** Latest run summaries returned by `listRuns`. Sorted newest-first. */
  runs: RunSummary[];
  /** Full run detail for the currently selected run id (if any). */
  activeRun: Run | null;
  activeRunId: string | null;
  /** Trace events keyed by runId. */
  eventsByRun: Record<string, TraceEvent[]>;
  isLoadingTemplates: boolean;
  isLoadingRuns: boolean;
  loadError: string | null;

  setShowOrchestrator: (show: boolean) => void;
  setTemplates: (templates: PipelineTemplate[]) => void;
  setRuns: (runs: RunSummary[]) => void;
  setActiveRun: (run: Run | null) => void;
  setActiveRunId: (runId: string | null) => void;
  upsertRunSummary: (summary: RunSummary) => void;
  appendTraceEvent: (event: TraceEvent) => void;
  resetEventsForRun: (runId: string) => void;
  setIsLoadingTemplates: (loading: boolean) => void;
  setIsLoadingRuns: (loading: boolean) => void;
  setLoadError: (message: string | null) => void;
  reset: () => void;
};

export const useOrchestratorStore = create<OrchestratorState>()(
  immer((set) => ({
    showOrchestrator: false,
    templates: [],
    runs: [],
    activeRun: null,
    activeRunId: null,
    eventsByRun: {},
    isLoadingTemplates: false,
    isLoadingRuns: false,
    loadError: null,

    setShowOrchestrator: (show) => {
      set((s) => {
        s.showOrchestrator = show;
      });
    },

    setTemplates: (templates) => {
      set((s) => {
        s.templates = templates;
      });
    },

    setRuns: (runs) => {
      set((s) => {
        s.runs = runs;
      });
    },

    setActiveRun: (run) => {
      set((s) => {
        s.activeRun = run;
        s.activeRunId = run?.id ?? s.activeRunId;
      });
    },

    setActiveRunId: (runId) => {
      set((s) => {
        s.activeRunId = runId;
      });
    },

    upsertRunSummary: (summary) => {
      set((s) => {
        const idx = s.runs.findIndex((r) => r.id === summary.id);
        if (idx === -1) {
          s.runs.unshift(summary);
        } else {
          s.runs[idx] = summary;
        }
      });
    },

    appendTraceEvent: (event) => {
      set((s) => {
        const list = s.eventsByRun[event.runId];
        if (list) {
          list.push(event);
        } else {
          s.eventsByRun[event.runId] = [event];
        }
      });
    },

    resetEventsForRun: (runId) => {
      set((s) => {
        delete s.eventsByRun[runId];
      });
    },

    setIsLoadingTemplates: (loading) => {
      set((s) => {
        s.isLoadingTemplates = loading;
      });
    },

    setIsLoadingRuns: (loading) => {
      set((s) => {
        s.isLoadingRuns = loading;
      });
    },

    setLoadError: (message) => {
      set((s) => {
        s.loadError = message;
      });
    },

    reset: () => {
      set((s) => {
        s.templates = [];
        s.runs = [];
        s.activeRun = null;
        s.activeRunId = null;
        s.eventsByRun = {};
        s.isLoadingTemplates = false;
        s.isLoadingRuns = false;
        s.loadError = null;
      });
    },
  })),
);
