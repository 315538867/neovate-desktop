/**
 * OrchestratorPanel — top-level overlay for the multi-agent pipeline UI.
 *
 * Layout mirrors `StatsPage`: a sidebar pinned to the left with a
 * "Back to app" affordance, and a content area on the right that switches
 * between an empty state, the run list, and the active run detail.
 *
 * Wave 3.4 commit 4.2 plugs in the live trace stream panel under the
 * stage graph; clicking a `stage.*` event row scrolls/selects the
 * matching execution highlight in the graph.
 */

import { ArrowLeft, Network, RefreshCw, Workflow } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
import { RunCard } from "./run-card";
import { StageGraph } from "./stage-graph";
import { TracePanel } from "./trace-panel";

export function OrchestratorPanel() {
  const setShowOrchestrator = useOrchestratorStore((s) => s.setShowOrchestrator);
  const runs = useOrchestratorStore((s) => s.runs);
  const templates = useOrchestratorStore((s) => s.templates);
  const activeRun = useOrchestratorStore((s) => s.activeRun);
  const activeRunId = useOrchestratorStore((s) => s.activeRunId);
  const setActiveRunId = useOrchestratorStore((s) => s.setActiveRunId);
  const isLoadingRuns = useOrchestratorStore((s) => s.isLoadingRuns);
  const loadError = useOrchestratorStore((s) => s.loadError);

  const activeProject = useProjectStore((s) => s.activeProject);
  const projectId = activeProject?.id;

  const { refresh } = useRuns({ projectId });
  useRunSubscription(activeRunId);

  const [selectedStageRef, setSelectedStageRef] = useState<{
    stageId: string;
    branchIndex: number;
  } | null>(null);

  // ESC closes the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setShowOrchestrator(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setShowOrchestrator]);

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
    return templates.find((t) => t.id === activeRun.templateId) ?? null;
  }, [activeRun, templates]);

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
            <span>Back to app</span>
          </button>
        </div>

        <div className="my-2 mx-3 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

        <div
          className="flex items-center justify-between gap-2 px-4"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Workflow className="size-4 text-primary" />
            <span>Pipelines</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={isLoadingRuns}>
            <RefreshCw className={cn("size-3.5", isLoadingRuns && "animate-spin")} />
          </Button>
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
              No pipeline runs yet.
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
              </header>

              {activeTemplate?.description && (
                <p className="mb-6 text-sm text-muted-foreground">{activeTemplate.description}</p>
              )}

              <section className="mb-8">
                <h2 className="mb-3 text-sm font-semibold text-foreground">Stages</h2>
                <StageGraph run={activeRun} template={activeTemplate} />
              </section>

              <section>
                <h2 className="mb-3 text-sm font-semibold text-foreground">Trace</h2>
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
                <EmptyTitle>No pipeline selected</EmptyTitle>
                <EmptyDescription>
                  Select a run from the sidebar to inspect its stage graph.
                </EmptyDescription>
              </EmptyContent>
            </Empty>
          </div>
        )}
      </div>
    </div>
  );
}
