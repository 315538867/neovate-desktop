import debug from "debug";
import { useCallback } from "react";

import type { PipelineTemplate } from "../../../../../shared/features/agent-orchestrator/schemas";

import { client } from "../../../orpc";
import { useOrchestratorStore } from "../store";

const hookLog = debug("neovate:use-orchestrator");

export function useOrchestrator() {
  const currentRunId = useOrchestratorStore((s) => s.currentRunId);
  const setCurrentRunId = useOrchestratorStore((s) => s.setCurrentRunId);
  const upsertRun = useOrchestratorStore((s) => s.upsertRun);
  const setRunStatus = useOrchestratorStore((s) => s.setRunStatus);
  const setLauncherOpen = useOrchestratorStore((s) => s.setLauncherOpen);

  const startRun = useCallback(
    async (params: {
      templateId: string;
      workspacePath: string;
      userPrompt: string;
      executorOverrides?: Record<string, string>;
      budget?: { maxTokens?: number; maxCost?: number; maxDurationMs?: number };
    }) => {
      hookLog("startRun: template=%s", params.templateId);
      const result = await client.orchestrator.startRun(params);
      setCurrentRunId(result.runId);
      return result.runId;
    },
    [setCurrentRunId],
  );

  const dryPlanRun = useCallback(
    async (params: { templateId: string; workspacePath: string; userPrompt: string }) => {
      return client.orchestrator.dryPlanRun(params);
    },
    [],
  );

  const cancelRun = useCallback(
    async (runId: string) => {
      hookLog("cancelRun: %s", runId);
      const result = await client.orchestrator.cancelRun({ runId });
      if (result.success) {
        setRunStatus(runId, "cancelled");
        if (currentRunId === runId) setCurrentRunId(null);
      }
      return result.success;
    },
    [currentRunId, setCurrentRunId, setRunStatus],
  );

  const pauseRun = useCallback(
    async (runId: string) => {
      hookLog("pauseRun: %s", runId);
      const result = await client.orchestrator.pauseRun({ runId });
      if (result.success) setRunStatus(runId, "paused");
      return result.success;
    },
    [setRunStatus],
  );

  const resumeRun = useCallback(
    async (runId: string) => {
      hookLog("resumeRun: %s", runId);
      const result = await client.orchestrator.resumeRun({ runId });
      if (result.success) setRunStatus(runId, "running");
      return result.success;
    },
    [setRunStatus],
  );

  const approveStage = useCallback(async (runId: string, instanceId: string) => {
    hookLog("approveStage: run=%s stage=%s", runId, instanceId);
    return client.orchestrator.approveStage({ runId, instanceId });
  }, []);

  const retryStage = useCallback(async (runId: string, instanceId: string, feedback?: string) => {
    hookLog("retryStage: run=%s stage=%s", runId, instanceId);
    return client.orchestrator.retryStage({
      runId,
      instanceId,
      feedback,
      forceFreshSession: false,
    });
  }, []);

  const skipStage = useCallback(async (runId: string, instanceId: string) => {
    hookLog("skipStage: run=%s stage=%s", runId, instanceId);
    return client.orchestrator.skipStage({ runId, instanceId });
  }, []);

  const submitStageEdit = useCallback(
    async (runId: string, instanceId: string, editedOutput: unknown) => {
      hookLog("submitStageEdit: run=%s stage=%s", runId, instanceId);
      return client.orchestrator.submitStageEdit({ runId, instanceId, editedOutput });
    },
    [],
  );

  const getRun = useCallback(
    async (runId: string) => {
      const run = await client.orchestrator.getRun({ runId });
      upsertRun(run);
      return run;
    },
    [upsertRun],
  );

  const listTemplates = useCallback(async (): Promise<PipelineTemplate[]> => {
    return client.orchestrator.listTemplates();
  }, []);

  const listRecoverableRuns = useCallback(async () => {
    return client.orchestrator.listRecoverableRuns();
  }, []);

  const resumeRunWithStrategy = useCallback(
    async (runId: string, instanceId: string, strategy: string) => {
      hookLog("resumeRunWithStrategy: run=%s stage=%s strategy=%s", runId, instanceId, strategy);
      return client.orchestrator.resumeRunWithStrategy({
        runId,
        instanceId,
        strategy: strategy as "restart" | "resume-with-context" | "skip-to-next" | "terminate",
      });
    },
    [],
  );

  const applyChangesToWorkspace = useCallback(
    async (runId: string, mode: "merge-to-main" | "apply-as-patch" = "merge-to-main") => {
      hookLog("applyChangesToWorkspace: run=%s mode=%s", runId, mode);
      return client.orchestrator.applyChangesToWorkspace({ runId, mode });
    },
    [],
  );

  const getConfig = useCallback(async (workspacePath?: string) => {
    return client.orchestrator.getConfig({ workspacePath });
  }, []);

  const setConfig = useCallback(
    async (patch: {
      mode?: "standard" | "orchestrated";
      defaultExecutorMap?: Record<string, string>;
      autoRunValidator?: boolean;
      maxConcurrentRuns?: number;
    }) => {
      return client.orchestrator.setConfig({ patch });
    },
    [],
  );

  return {
    startRun,
    dryPlanRun,
    cancelRun,
    pauseRun,
    resumeRun,
    approveStage,
    retryStage,
    skipStage,
    submitStageEdit,
    getRun,
    listTemplates,
    listRecoverableRuns,
    resumeRunWithStrategy,
    applyChangesToWorkspace,
    getConfig,
    setConfig,
    setLauncherOpen,
  };
}
