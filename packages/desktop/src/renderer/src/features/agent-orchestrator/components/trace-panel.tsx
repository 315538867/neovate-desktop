/**
 * TracePanel — live event stream view alongside the StageGraph.
 *
 * Wave 3.4 commit 4.2 wires a chip-based category filter, an auto-scroll
 * pause toggle, and a clear button on top of `useTraceStream`. Clicking
 * a `stage.end` row bubbles `onSelectStage` so the parent can highlight
 * the matching execution in the graph.
 */

import { Eraser, ListFilter, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { TraceEvent } from "../../../../../shared/features/agent-orchestrator/types";

import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import {
  type TraceCategory,
  TRACE_CATEGORIES,
  TRACE_CATEGORY_LABEL,
  useTraceStream,
} from "../hooks/use-trace-stream";
import { useOrchestratorStore } from "../store";
import { TraceEventRow } from "./trace-event-row";

export interface TracePanelProps {
  runId: string | null;
  runStartedAt?: number;
  selectedStageRef?: { stageId: string; branchIndex: number } | null;
  onSelectStage?: (stageId: string, branchIndex: number) => void;
}

export function TracePanel({
  runId,
  runStartedAt,
  selectedStageRef,
  onSelectStage,
}: TracePanelProps) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<TraceCategory[]>(() => [...TRACE_CATEGORIES]);
  const [paused, setPaused] = useState(false);
  const resetEventsForRun = useOrchestratorStore((s) => s.resetEventsForRun);

  const { events, totalCount } = useTraceStream(runId, { enabled });
  const filteredOut = totalCount - events.length;

  const listRef = useRef<HTMLDivElement | null>(null);
  const lastSeenSeq = useRef<number>(-1);

  // Auto-scroll on new events unless paused or user has scrolled away.
  useEffect(() => {
    if (paused) return;
    const node = listRef.current;
    if (!node) return;
    const newest = events.at(-1);
    if (!newest) return;
    if (newest.seq === lastSeenSeq.current) return;
    lastSeenSeq.current = newest.seq;
    // Only stick to bottom if we were already near it (≤ 80px gap).
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (distance <= 80) {
      node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    }
  }, [events, paused]);

  // Reset the seq cursor whenever the active run changes so the new run
  // re-anchors at the bottom on first render.
  useEffect(() => {
    lastSeenSeq.current = -1;
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [runId]);

  const handleToggle = (category: TraceCategory) => {
    setEnabled((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category],
    );
  };

  const handleClear = () => {
    if (runId) resetEventsForRun(runId);
  };

  const isClickable = (event: TraceEvent): boolean =>
    event.type === "stage.end" || event.type === "stage.error" || event.type === "stage.start";

  const matchesSelection = (event: TraceEvent): boolean => {
    if (!selectedStageRef) return false;
    if (
      event.type !== "stage.end" &&
      event.type !== "stage.error" &&
      event.type !== "stage.start"
    ) {
      return false;
    }
    return (
      event.stageId === selectedStageRef.stageId &&
      event.branchIndex === selectedStageRef.branchIndex
    );
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-border bg-card">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ListFilter className="size-3.5" />
          <span>{t("orchestrator.trace.filter")}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {TRACE_CATEGORIES.map((category) => {
            const active = enabled.includes(category);
            return (
              <Chip
                key={category}
                active={active}
                onClick={() => handleToggle(category)}
                label={TRACE_CATEGORY_LABEL[category]}
              />
            );
          })}
        </div>
        <div className="ms-auto flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">
            {events.length}
            {filteredOut > 0 ? ` / ${totalCount}` : ""}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPaused((p) => !p)}
            title={paused ? t("orchestrator.trace.resume") : t("orchestrator.trace.pause")}
          >
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={!runId || totalCount === 0}
            title={t("orchestrator.trace.clear")}
          >
            <Eraser className="size-3.5" />
          </Button>
        </div>
      </header>

      <div ref={listRef} className="flex-1 overflow-y-auto px-2 py-1">
        {!runId ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t("orchestrator.trace.empty.noRun")}
          </p>
        ) : events.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {totalCount === 0
              ? t("orchestrator.trace.empty.waiting")
              : t("orchestrator.trace.empty.filtered")}
          </p>
        ) : (
          <Rows
            events={events}
            runStartedAt={runStartedAt}
            isHighlighted={matchesSelection}
            onSelectStage={onSelectStage}
            isClickable={isClickable}
          />
        )}
      </div>
    </div>
  );
}

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
        active
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border bg-transparent text-muted-foreground hover:bg-accent/40",
      )}
    >
      {label}
    </button>
  );
}

interface RowsProps {
  events: TraceEvent[];
  runStartedAt?: number;
  isHighlighted: (event: TraceEvent) => boolean;
  isClickable: (event: TraceEvent) => boolean;
  onSelectStage?: (stageId: string, branchIndex: number) => void;
}

function Rows({ events, runStartedAt, isHighlighted, isClickable, onSelectStage }: RowsProps) {
  return (
    <div className="space-y-0.5">
      {events.map((event) => (
        <TraceEventRow
          key={`${event.runId}-${event.seq}`}
          event={event}
          runStartedAt={runStartedAt}
          isHighlighted={isHighlighted(event)}
          onClick={
            isClickable(event) && onSelectStage
              ? () =>
                  onSelectStage(
                    "stageId" in event ? event.stageId : "",
                    "branchIndex" in event ? event.branchIndex : 0,
                  )
              : undefined
          }
        />
      ))}
    </div>
  );
}
