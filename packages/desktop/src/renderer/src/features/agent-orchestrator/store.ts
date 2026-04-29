import debug from "debug";
import { enableMapSet } from "immer";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import type {
  PipelineRun,
  PipelineRunStatus,
  StageRunRecord,
  StageRunStatus,
  SubtaskRecord,
} from "../../../../shared/features/agent-orchestrator/schemas";

const orchLog = debug("neovate:orchestrator-store");

enableMapSet();

export type OrchestratorMode = "standard" | "orchestrated";

export type RunCache = {
  run: PipelineRun;
  events: OrchestratorEvent[];
  loaded: boolean;
};

export type OrchestratorEvent = {
  type: string;
  timestamp: string;
  runId: string;
  stageInstanceId?: string;
  payload: unknown;
};

export type StageDetail = {
  instanceId: string;
  stageId: string;
  status: StageRunStatus;
  input: unknown;
  output: unknown;
  errors: StageRunRecord["errors"];
  subtasks: SubtaskRecord[];
  startedAt?: string;
  completedAt?: string;
  attempt: number;
};

type OrchestratorState = {
  mode: OrchestratorMode;
  modeLoaded: boolean;
  currentRunId: string | null;
  runs: Map<string, RunCache>;
  stageDetails: Map<string, StageDetail>;
  expandedStageId: string | null;
  launcherOpen: boolean;
  recoveryDialogOpen: boolean;

  setMode: (mode: OrchestratorMode) => void;
  setModeLoaded: (loaded: boolean) => void;

  setCurrentRunId: (runId: string | null) => void;

  upsertRun: (run: PipelineRun) => void;
  removeRun: (runId: string) => void;
  setRunStatus: (runId: string, status: PipelineRunStatus) => void;

  setRunEvents: (runId: string, events: OrchestratorEvent[]) => void;
  appendRunEvent: (runId: string, event: OrchestratorEvent) => void;

  setStageDetail: (stage: StageDetail) => void;
  upsertStageStatus: (runId: string, instanceId: string, status: StageRunStatus) => void;
  setExpandedStageId: (instanceId: string | null) => void;

  setLauncherOpen: (open: boolean) => void;
  setRecoveryDialogOpen: (open: boolean) => void;

  reset: () => void;
};

const initialState = {
  mode: "standard" as OrchestratorMode,
  modeLoaded: false,
  currentRunId: null as string | null,
  runs: new Map<string, RunCache>(),
  stageDetails: new Map<string, StageDetail>(),
  expandedStageId: null as string | null,
  launcherOpen: false,
  recoveryDialogOpen: false,
};

export const useOrchestratorStore = create<OrchestratorState>()(
  immer((set) => ({
    ...initialState,

    setMode: (mode) => {
      orchLog("setMode: %s", mode);
      set((state) => {
        state.mode = mode;
        state.modeLoaded = true;
      });
    },

    setModeLoaded: (loaded) => {
      set((state) => {
        state.modeLoaded = loaded;
      });
    },

    setCurrentRunId: (runId) => {
      orchLog("setCurrentRunId: %s", runId);
      set((state) => {
        state.currentRunId = runId;
      });
    },

    upsertRun: (run) => {
      orchLog("upsertRun: %s status=%s", run.runId, run.status);
      set((state) => {
        const existing = state.runs.get(run.runId);
        state.runs.set(run.runId, {
          run,
          events: existing?.events ?? [],
          loaded: true,
        });
      });
    },

    removeRun: (runId) => {
      orchLog("removeRun: %s", runId);
      set((state) => {
        state.runs.delete(runId);
        if (state.currentRunId === runId) {
          state.currentRunId = null;
        }
      });
    },

    setRunStatus: (runId, status) => {
      set((state) => {
        const cached = state.runs.get(runId);
        if (cached) {
          cached.run.status = status;
        }
      });
    },

    setRunEvents: (runId, events) => {
      set((state) => {
        const cached = state.runs.get(runId);
        if (cached) {
          cached.events = events;
        } else {
          state.runs.set(runId, { run: {} as PipelineRun, events, loaded: false });
        }
      });
    },

    appendRunEvent: (runId, event) => {
      set((state) => {
        const cached = state.runs.get(runId);
        if (cached) {
          cached.events.push(event);
        }
      });
    },

    setStageDetail: (stage) => {
      set((state) => {
        state.stageDetails.set(stage.instanceId, stage);
      });
    },

    upsertStageStatus: (runId, instanceId, status) => {
      set((state) => {
        const cached = state.runs.get(runId);
        if (!cached) return;
        const stageRun = cached.run.stageRuns.find((s) => s.instanceId === instanceId);
        if (stageRun) {
          stageRun.status = status;
        }
      });
    },

    setExpandedStageId: (instanceId) => {
      set((state) => {
        state.expandedStageId = instanceId;
      });
    },

    setLauncherOpen: (open) => {
      set((state) => {
        state.launcherOpen = open;
      });
    },

    setRecoveryDialogOpen: (open) => {
      set((state) => {
        state.recoveryDialogOpen = open;
      });
    },

    reset: () => {
      set((state) => {
        state.currentRunId = null;
        state.runs = new Map();
        state.stageDetails = new Map();
        state.expandedStageId = null;
        state.launcherOpen = false;
        state.recoveryDialogOpen = false;
      });
    },
  })),
);
