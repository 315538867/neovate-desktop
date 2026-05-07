/**
 * OrchestratorPanel — top-level overlay for the multi-agent pipeline UI.
 *
 * Wave 3.5: localised + operationally complete. The sidebar exposes a
 * "+ New run" affordance, the active-run header offers a Cancel button
 * while the run is alive, gate-pause states surface a `<GateApproval/>`
 * panel inline, and crash-recovered runs surface a `<RecoveryBanner/>`
 * above the run list.
 */

import { ArrowLeft, Network, PlusCircle, RefreshCw, StopCircle, Workflow } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../../components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "../../../components/ui/empty";
import { Spinner } from "../../../components/ui/spinner";
import { cn } from "../../../lib/utils";
import { useProjectStore } from "../../project/store";
import { useRunSubscription } from "../hooks/use-run-subscription";
import { useRuns } from "../hooks/use-runs";
import { useOrchestratorStore } from "../store";
import { GateApproval } from "./gate-approval";
import { RecoveryBanner } from "./recovery-banner";
import { RunCard } from "./run-card";
import { StageGraph } from "./stage-graph";
import { StartRunDialog } from "./start-run-dialog";
import { TracePanel } from "./trace-panel";

export function OrchestratorPanel() {
  const { t } = useTranslation();
  const setShowOrchestrator = useOrchestratorStore((s) => s.setShowOrchestrator);
  const runs = useOrchestratorStore((s) => s.runs);
  const templates = useOrchestratorStore((s) => s.templates);
  const activeRun = useOrchestratorStore((s) => s.activeRun);
  const activeRunId = useOrchestratorStore((s) => s.activeRunId);
  const setActiveRunId = useOrchestratorStore((s) => s.setActiveRunId);
  const isLoadingRuns = useOrchestratorStore((s) => s.isLoadingRuns);
  const loadError = useOrchestratorStore((s) => s.loadError);
  const cancelRun = useOrchestratorStore((s) => s.cancelRun);
  const cancellingRunIds = useOrchestratorStore((s) => s.cancellingRunIds);

  const activeProject = useProjectStore((s) => s.activeProject);
  const projectId = activeProject?.id;

  const { refresh } = useRuns({ projectId });
  useRunSubscription(activeRunId);

  const [selectedStageRef, setSelectedStageRef] = useState<{
    stageId: string;
    branchIndex: number;
  } | null>(null);
  const [startDialogOpen, setStartDialogOpen] = useState(false);

  // ESC closes the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (startDialogOpen) return; // dialog handles its own ESC
        e.preventDefault();
        setShowOrchestrator(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setShowOrchestrator, startDialogOpen]);

  // Auto-select the most recent run if none is selected yet.
  useEffect(() => {
    if (!activeRunId && runs.length > 0) {
      setActiveRunId(runs[0].id);
    }
  }, [activeRunId, runs, setActiveRunId]);

  // Reset selected trace stage whenever the active run changes.
  useEffect(() => {
    setSelectedStageRef(null);
  }, [activeRunId]);

  const activeTemplate = useMemo(() => {
    if (!activeRun) return null;
    return templates.find((tpl) => tpl.id === activeRun.templateId) ?? null;
  }, [activeRun, templates]);

  const isCancellable = activeRun
    ? activeRun.status === "running" || activeRun.status === "paused_user_gate"
    : false;
  const isCancelling = activeRun ? Boolean(cancellingRunIds[activeRun.id]) : false;
  const showGatePanel =
    activeRun?.status === "paused_user_gate" && activeRun.currentStageId
      ? activeRun.currentStageId
      : null;

  return (
    <div className="absolute inset-0 z-50 flex bg-background">
      {/* Left sidebar — list of runs */}
      <div
        className="flex h-full w-72 flex-col border-r border-border bg-background pt-10"
        style={{
          // @ts-expect-error - Electron specific CSS property
          WebkitAppRegion: "drag",
        }}
      >
        <div className="px-3" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-all hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setShowOrchestrator(false)}
          >
            <ArrowLeft className="size-4" />
            <span>{t("orchestrator.backToApp")}</span>
          </button>
        </div>

        <div className="my-2 mx-3 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

        <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <RecoveryBanner />
        </div>

        <div
          className="flex items-center justify-between gap-2 px-4"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Workflow className="size-4 text-primary" />
            <span>{t("orchestrator.pipelines")}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStartDialogOpen(true)}
              title={t("orchestrator.action.newRun")}
              disabled={templates.length === 0}
            >
              <PlusCircle className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refresh()}
              disabled={isLoadingRuns}
              title={t("orchestrator.refresh")}
            >
              <RefreshCw className={cn("size-3.5", isLoadingRuns && "animate-spin")} />
            </Button>
          </div>
        </div>

        <div
          className="flex-1 overflow-y-auto px-3 pb-4"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {isLoadingRuns && runs.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Spinner className="size-5" />
            </div>
          ) : loadError ? (
            <p className="px-2 text-xs text-destructive-foreground">{loadError}</p>
          ) : runs.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              {t("orchestrator.empty")}
            </p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {runs.map((run) => (
                <RunCard
                  key={run.id}
                  run={run}
                  selected={run.id === activeRunId}
                  onClick={() => setActiveRunId(run.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right content — run detail */}
      <div className="flex flex-1 flex-col overflow-hidden bg-gradient-to-b from-card to-background">
        <div
          className="h-10"
          style={{
            // @ts-expect-error - Electron specific CSS property
            WebkitAppRegion: "drag",
          }}
        />

        {activeRun ? (
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-4xl px-8 pb-12">
              <header className="mb-6 flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10">
                  <Network className="size-5 text-primary" />
                </span>
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-xl font-semibold text-foreground">
                    {activeTemplate?.name ?? activeRun.templateId}
                  </h1>
                  <p className="truncate font-mono text-xs text-muted-foreground">{activeRun.id}</p>
                </div>
                {isCancellable && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void cancelRun(activeRun.id)}
                    disabled={isCancelling}
                  >
                    <StopCircle className="size-3.5" />
                    {isCancelling
                      ? t("orchestrator.action.cancelling")
                      : t("orchestrator.action.cancel")}
                  </Button>
                )}
              </header>

              {activeTemplate?.description && (
                <p className="mb-6 text-sm text-muted-foreground">{activeTemplate.description}</p>
              )}

              {showGatePanel && <GateApproval runId={activeRun.id} stageId={showGatePanel} />}

              <section className="mb-8">
                <h2 className="mb-3 text-sm font-semibold text-foreground">
                  {t("orchestrator.section.stages")}
                </h2>
                <StageGraph run={activeRun} template={activeTemplate} />
              </section>

              <section>
                <h2 className="mb-3 text-sm font-semibold text-foreground">
                  {t("orchestrator.section.trace")}
                </h2>
                <div className="h-[420px]">
                  <TracePanel
                    runId={activeRunId}
                    runStartedAt={activeRun.startedAt}
                    selectedStageRef={selectedStageRef}
                    onSelectStage={(stageId, branchIndex) =>
                      setSelectedStageRef({ stageId, branchIndex })
                    }
                  />
                </div>
              </section>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <Empty>
              <EmptyMedia variant="icon">
                <Network className="size-6" />
              </EmptyMedia>
              <EmptyContent>
                <EmptyTitle>{t("orchestrator.noSelection.title")}</EmptyTitle>
                <EmptyDescription>{t("orchestrator.noSelection.description")}</EmptyDescription>
              </EmptyContent>
              {templates.length > 0 && (
                <Button size="sm" className="mt-3" onClick={() => setStartDialogOpen(true)}>
                  <PlusCircle className="size-3.5" />
                  {t("orchestrator.action.newRun")}
                </Button>
              )}
            </Empty>
          </div>
        )}
      </div>

      <StartRunDialog open={startDialogOpen} onOpenChange={setStartDialogOpen} />
    </div>
  );
}
