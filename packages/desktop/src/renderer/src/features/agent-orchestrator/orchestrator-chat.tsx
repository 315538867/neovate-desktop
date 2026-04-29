import { useCallback, useEffect, useState } from "react";

import type {
  ArchitectureDoc,
  AcceptanceReport,
  ImplementationResult,
  StageRunRecord,
  SubtaskRecord,
} from "../../../../shared/features/agent-orchestrator/schemas";
import type { OrchestratorEvent } from "./store";

import { Button } from "../../components/ui/button";
import { Separator } from "../../components/ui/separator";
import { useProjectStore } from "../project/store";
import { ArchitectureReviewCard } from "./components/architecture-review-card";
import { BudgetIndicator } from "./components/budget-indicator";
import { ErrorDrawer } from "./components/error-drawer";
import { FanoutTimeline } from "./components/fanout-timeline";
import { ImplementationProgressCard } from "./components/implementation-progress-card";
import { LauncherDialog } from "./components/launcher-dialog";
import { ModeToggle } from "./components/mode-toggle";
import { PipelineTimeline } from "./components/pipeline-timeline";
import { RecoveryDialog } from "./components/recovery-dialog";
import { StageActionButtons } from "./components/stage-action-buttons";
import { ValidationReportCard } from "./components/validation-report-card";
import { useOrchestrator } from "./hooks/use-orchestrator";
import { useRun } from "./hooks/use-run";
import { useOrchestratorStore } from "./store";

export function OrchestratorChat() {
  const currentRunId = useOrchestratorStore((s) => s.currentRunId);
  const setCurrentRunId = useOrchestratorStore((s) => s.setCurrentRunId);
  const expandedStageId = useOrchestratorStore((s) => s.expandedStageId);
  const setLauncherOpen = useOrchestratorStore((s) => s.setLauncherOpen);
  const setRecoveryOpen = useOrchestratorStore((s) => s.setRecoveryDialogOpen);

  const workspacePath = useProjectStore((s) => s.activeProject?.path ?? "");

  const { run, events, loaded } = useRun(currentRunId);
  const { listRecoverableRuns } = useOrchestrator();

  const [errorDrawerOpen, setErrorDrawerOpen] = useState(false);
  const [errorStage, setErrorStage] = useState<StageRunRecord | undefined>();
  const [recoveries, setRecoveries] = useState<
    Array<{ runId: string; instanceId: string; reason: string }>
  >([]);

  // 启动时检查是否有可恢复的 Run
  useEffect(() => {
    listRecoverableRuns()
      .then((items) => {
        if (items.length > 0) {
          setRecoveries(
            items.map((item) => ({
              runId: item.run?.runId ?? "",
              instanceId: item.stage?.instanceId ?? "",
              reason: item.recommendedAction,
            })),
          );
          if (items.length === 1) {
            setCurrentRunId(items[0].run?.runId ?? "");
          }
        }
      })
      .catch(() => {});
  }, []);

  const handleNewRun = useCallback(() => {
    setLauncherOpen(true);
  }, [setLauncherOpen]);

  const handleShowError = useCallback((stage: StageRunRecord) => {
    setErrorStage(stage);
    setErrorDrawerOpen(true);
  }, []);

  const stageLabelMap: Record<string, string> = {
    architect: "Architect",
    reviewer: "Reviewer",
    implementer: "Implementer",
    validator: "Validator",
  };

  // 展开的 stage 详情
  const expandedStage =
    run && expandedStageId
      ? run.stageRuns.find((s) => s.instanceId === expandedStageId)
      : undefined;

  return (
    <div className="flex h-full flex-col" aria-label="Orchestrator chat">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Orchestrator</span>
          {run && (
            <span className="text-[11px] text-muted-foreground">
              {run.templateId} — {run.status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {recoveries.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] text-yellow-400"
              onClick={() => setRecoveryOpen(true)}
            >
              {recoveries.length} recoverable
            </Button>
          )}
          <ModeToggle />
        </div>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col">
        {!currentRunId ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="space-y-4 text-center">
              <div className="space-y-1">
                <p className="text-sm font-medium">No active pipeline</p>
                <p className="text-xs text-muted-foreground">
                  Launch an orchestrated pipeline to plan and implement changes.
                </p>
              </div>
              <Button onClick={handleNewRun} className="bg-[#fa216e] hover:bg-[#fa216e]/90">
                New Pipeline
              </Button>
            </div>
          </div>
        ) : !loaded ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-xs text-muted-foreground">Loading run...</p>
          </div>
        ) : run ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
            {/* Budget */}
            <BudgetIndicator budget={run.budget} />

            {/* Pipeline Timeline */}
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
              <PipelineTimeline run={run} />

              {/* Expanded stage detail */}
              {expandedStage &&
                (() => {
                  const stageOutput = expandedStage.output;
                  return (
                    <div className="space-y-2 rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">
                          {stageLabelMap[expandedStage.stageId] ?? expandedStage.stageId} Details
                        </span>
                        <div className="flex items-center gap-2">
                          {expandedStage.errors.length > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-[10px] text-red-400"
                              onClick={() => handleShowError(expandedStage)}
                            >
                              {expandedStage.errors.length} errors
                            </Button>
                          )}
                          <StageActionButtons
                            runId={run.runId}
                            instanceId={expandedStage.instanceId}
                            stageStatus={expandedStage.status}
                          />
                        </div>
                      </div>

                      <Separator />

                      {/* Architecture output */}
                      {expandedStage.stageId === "architect" &&
                      stageOutput != null &&
                      isArchitectureDoc(stageOutput) ? (
                        <ArchitectureReviewCard output={stageOutput} />
                      ) : null}

                      {/* Implementer output */}
                      {expandedStage.stageId === "implementer" ? (
                        <ImplementationProgressCard
                          output={
                            stageOutput != null && isImplementationResult(stageOutput)
                              ? stageOutput
                              : undefined
                          }
                          subtasks={getSubtasksForStage(expandedStage, events)}
                        />
                      ) : null}

                      {/* Validator output */}
                      {expandedStage.stageId === "validator" &&
                      stageOutput != null &&
                      isAcceptanceReport(stageOutput) ? (
                        <ValidationReportCard report={stageOutput} />
                      ) : null}

                      {/* Fan-out children */}
                      {expandedStage.fanOutParentInstanceId && (
                        <FanoutTimeline
                          children={run.stageRuns.filter(
                            (s) => s.fanOutParentInstanceId === expandedStage.instanceId,
                          )}
                        />
                      )}
                    </div>
                  );
                })()}
            </div>
          </div>
        ) : null}
      </div>

      {/* Dialogs / drawers */}
      <LauncherDialog workspacePath={workspacePath} />
      <ErrorDrawer
        open={errorDrawerOpen}
        onClose={() => setErrorDrawerOpen(false)}
        stage={errorStage}
        stageLabel={errorStage ? stageLabelMap[errorStage.stageId] : undefined}
      />
      {recoveries.length > 0 && (
        <RecoveryDialog
          runId={recoveries[0].runId}
          instanceId={recoveries[0].instanceId}
          reason={recoveries[0].reason}
        />
      )}
    </div>
  );
}

// — Type guards —

function isArchitectureDoc(v: unknown): v is ArchitectureDoc {
  return typeof v === "object" && v !== null && "goal" in v && "modules" in v;
}

function isImplementationResult(v: unknown): v is ImplementationResult {
  return typeof v === "object" && v !== null && "filesChanged" in v;
}

function isAcceptanceReport(v: unknown): v is AcceptanceReport {
  return typeof v === "object" && v !== null && "defects" in v && "matchesArchitecture" in v;
}

function getSubtasksForStage(stage: StageRunRecord, _events: OrchestratorEvent[]): SubtaskRecord[] {
  if (stage.output && typeof stage.output === "object" && "subtaskLog" in stage.output) {
    return (stage.output as { subtaskLog: SubtaskRecord[] }).subtaskLog;
  }
  return [];
}
