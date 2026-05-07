/**
 * Agent Orchestrator — renderer store.
 *
 * Tracks pipeline runs, their summaries, the active run detail, and the
 * trace event timeline buffered per run. Action thunks (`startRun`,
 * `cancelRun`, `approveGate`, `resumeRunWithStrategy`, `loadRecoverable`)
 * wrap the oRPC calls so components stay declarative; failures are routed
 * through `reportError` so the toast layer surfaces them.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import type {
  PipelineTemplate,
  RecoverableRun,
  ResumeStrategy,
  Run,
  RunSummary,
  TraceEvent,
} from "../../../../shared/features/agent-orchestrator/types";

import { reportError } from "../../core/error-reporter";
import { client } from "../../orpc";

export type StartRunArgs = {
  templateId: string;
  cwd: string;
  variables?: Record<string, string>;
  projectId?: string;
};

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
  /** Recoverable runs surfaced by the recovery banner. */
  recoverableRuns: RecoverableRun[];
  isLoadingTemplates: boolean;
  isLoadingRuns: boolean;
  /** Inline status flags so buttons can show pending state. */
  isStartingRun: boolean;
  cancellingRunIds: Record<string, boolean>;
  approvingGateIds: Record<string, boolean>;
  resumingRunIds: Record<string, boolean>;
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
  setRecoverableRuns: (runs: RecoverableRun[]) => void;

  /** Action thunks — wrap oRPC. Resolve with the new resource on success. */
  startRun: (args: StartRunArgs) => Promise<Run | undefined>;
  cancelRun: (runId: string, reason?: string) => Promise<boolean>;
  approveGate: (
    runId: string,
    stageId: string,
    approved: boolean,
    note?: string,
  ) => Promise<boolean>;
  resumeRunWithStrategy: (
    runId: string,
    strategy: ResumeStrategy,
    note?: string,
  ) => Promise<Run | undefined>;
  loadRecoverable: () => Promise<void>;
  reset: () => void;
};

export const useOrchestratorStore = create<OrchestratorState>()(
  immer((set, get) => ({
    showOrchestrator: false,
    templates: [],
    runs: [],
    activeRun: null,
    activeRunId: null,
    eventsByRun: {},
    recoverableRuns: [],
    isLoadingTemplates: false,
    isLoadingRuns: false,
    isStartingRun: false,
    cancellingRunIds: {},
    approvingGateIds: {},
    resumingRunIds: {},
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

    setRecoverableRuns: (runs) => {
      set((s) => {
        s.recoverableRuns = runs;
      });
    },

    startRun: async (args) => {
      set((s) => {
        s.isStartingRun = true;
      });
      try {
        const run = await client.agent.orchestrator.startRun(args);
        set((s) => {
          // Surface immediately as an active row; live subscription will
          // backfill the rest.
          const summary: RunSummary = {
            id: run.id,
            templateId: run.templateId,
            templateVersion: run.templateVersion,
            projectId: run.projectId,
            cwd: run.cwd,
            status: run.status,
            startedAt: run.startedAt,
            completedAt: run.completedAt,
            currentStageId: run.currentStageId,
            budgetUsage: run.budgetUsage,
            completedStageCount: run.executions.filter((e) => e.status === "succeeded").length,
            totalStageCount: run.executions.length,
          };
          const idx = s.runs.findIndex((r) => r.id === summary.id);
          if (idx === -1) s.runs.unshift(summary);
          else s.runs[idx] = summary;
          s.activeRun = run;
          s.activeRunId = run.id;
        });
        return run;
      } catch (err) {
        reportError(err, { op: "orchestrator.startRun", templateId: args.templateId });
        return undefined;
      } finally {
        set((s) => {
          s.isStartingRun = false;
        });
      }
    },

    cancelRun: async (runId, reason) => {
      set((s) => {
        s.cancellingRunIds[runId] = true;
      });
      try {
        const result = await client.agent.orchestrator.cancelRun({ runId, reason });
        return result.cancelled;
      } catch (err) {
        reportError(err, { op: "orchestrator.cancelRun", runId });
        return false;
      } finally {
        set((s) => {
          delete s.cancellingRunIds[runId];
        });
      }
    },

    approveGate: async (runId, stageId, approved, note) => {
      const key = `${runId}:${stageId}`;
      set((s) => {
        s.approvingGateIds[key] = true;
      });
      try {
        const result = await client.agent.orchestrator.approveGate({
          runId,
          stageId,
          approved,
          note,
        });
        return result.accepted;
      } catch (err) {
        reportError(err, { op: "orchestrator.approveGate", runId, stageId });
        return false;
      } finally {
        set((s) => {
          delete s.approvingGateIds[key];
        });
      }
    },

    resumeRunWithStrategy: async (runId, strategy, note) => {
      set((s) => {
        s.resumingRunIds[runId] = true;
      });
      try {
        const run = await client.agent.orchestrator.resumeRunWithStrategy({
          runId,
          strategy,
          note,
        });
        set((s) => {
          s.recoverableRuns = s.recoverableRuns.filter((r) => r.runId !== runId);
          s.activeRun = run;
          s.activeRunId = run.id;
        });
        return run;
      } catch (err) {
        reportError(err, { op: "orchestrator.resumeRun", runId, strategy });
        return undefined;
      } finally {
        set((s) => {
          delete s.resumingRunIds[runId];
        });
      }
    },

    loadRecoverable: async () => {
      try {
        const list = await client.agent.orchestrator.listRecoverableRuns({});
        set((s) => {
          s.recoverableRuns = list;
        });
      } catch (err) {
        reportError(err, { op: "orchestrator.listRecoverableRuns" });
      }
      // Avoid unused-warning if get() is removed.
      void get;
    },

    reset: () => {
      set((s) => {
        s.templates = [];
        s.runs = [];
        s.activeRun = null;
        s.activeRunId = null;
        s.eventsByRun = {};
        s.recoverableRuns = [];
        s.isLoadingTemplates = false;
        s.isLoadingRuns = false;
        s.isStartingRun = false;
        s.cancellingRunIds = {};
        s.approvingGateIds = {};
        s.resumingRunIds = {};
        s.loadError = null;
      });
    },
  })),
);
