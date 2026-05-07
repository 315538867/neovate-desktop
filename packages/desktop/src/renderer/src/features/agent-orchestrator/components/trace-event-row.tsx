/**
 * TraceEventRow — single row in the trace event stream.
 *
 * Renders a colour-coded icon, a one-line summary specific to the event
 * variant, and a relative timestamp. `stage.end` rows are clickable so
 * the parent can scroll the StageGraph to the corresponding execution.
 */

import {
  AlertTriangle,
  Box,
  Clock,
  Flag,
  GitFork,
  HeartPulse,
  Pause,
  Play,
  Wallet,
  XCircle,
} from "lucide-react";

import type {
  TraceEvent,
  TraceEventType,
} from "../../../../../shared/features/agent-orchestrator/types";

import { cn } from "../../../lib/utils";

const ICON_BY_TYPE: Record<TraceEventType, React.ComponentType<{ className?: string }>> = {
  "run.start": Play,
  "run.end": Flag,
  "run.cancel": XCircle,
  "stage.start": Box,
  "stage.end": Box,
  "stage.error": AlertTriangle,
  "gate.requested": Pause,
  "gate.resolved": Play,
  "budget.exceeded": Wallet,
  "fanout.expanded": GitFork,
  "fanin.aggregated": GitFork,
  "recovery.detected": HeartPulse,
  "recovery.resumed": HeartPulse,
};

const TONE_BY_TYPE: Record<TraceEventType, string> = {
  "run.start": "text-info-foreground",
  "run.end": "text-success-foreground",
  "run.cancel": "text-destructive-foreground",
  "stage.start": "text-info-foreground",
  "stage.end": "text-success-foreground",
  "stage.error": "text-destructive-foreground",
  "gate.requested": "text-warning-foreground",
  "gate.resolved": "text-info-foreground",
  "budget.exceeded": "text-destructive-foreground",
  "fanout.expanded": "text-foreground",
  "fanin.aggregated": "text-foreground",
  "recovery.detected": "text-warning-foreground",
  "recovery.resumed": "text-info-foreground",
};

function describe(event: TraceEvent): string {
  switch (event.type) {
    case "run.start":
      return `Run started · template ${event.templateId}`;
    case "run.end":
      return `Run finished · ${event.status}`;
    case "run.cancel":
      return event.reason ? `Run cancelled · ${event.reason}` : "Run cancelled";
    case "stage.start":
      return `Stage started · ${event.stageId}${event.branchIndex ? ` #${event.branchIndex}` : ""}`;
    case "stage.end":
      return `Stage ${event.status} · ${event.stageId}${
        event.branchIndex ? ` #${event.branchIndex}` : ""
      } · ${formatDuration(event.durationMs)}`;
    case "stage.error":
      return `Stage error · ${event.stageId} · ${event.level} · ${event.message}`;
    case "gate.requested":
      return `Gate requested · ${event.stageId}`;
    case "gate.resolved":
      return `Gate ${event.approved ? "approved" : "rejected"} · ${event.stageId}`;
    case "budget.exceeded":
      return `Budget exceeded · ${event.dimension} · used ${formatUsage(
        event.dimension,
        event.usage,
      )}`;
    case "fanout.expanded":
      return `Fan-out · ${event.stageId} → ${event.branches} branches`;
    case "fanin.aggregated":
      return `Fan-in · ${event.stageId} ← ${event.sourceCount} sources`;
    case "recovery.detected":
      return `Recovery detected · prior status ${event.foundStatus}`;
    case "recovery.resumed":
      return `Recovery resumed · ${event.strategy}`;
    default: {
      // Compile-time exhaustiveness check.
      const exhaustive: never = event;
      void exhaustive;
      return "Unknown event";
    }
  }
}

function formatUsage(
  dimension: "tokens" | "duration" | "cost" | "stages",
  usage: {
    usedTokens: number;
    usedDurationMs: number;
    usedCostUsd: number;
    completedStages: number;
  },
): string {
  switch (dimension) {
    case "tokens":
      return `${usage.usedTokens.toLocaleString()} tokens`;
    case "duration":
      return formatDuration(usage.usedDurationMs);
    case "cost":
      return `$${usage.usedCostUsd.toFixed(4)}`;
    case "stages":
      return `${usage.completedStages} stages`;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${Math.round(sec % 60)}s`;
}

function formatTimestamp(ts: number, runStartedAt?: number): string {
  if (!runStartedAt) return new Date(ts).toLocaleTimeString();
  const diff = Math.max(0, ts - runStartedAt);
  if (diff < 1000) return `+${diff}ms`;
  const sec = diff / 1000;
  if (sec < 60) return `+${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  return `+${min}m${String(Math.round(sec % 60)).padStart(2, "0")}s`;
}

export interface TraceEventRowProps {
  event: TraceEvent;
  runStartedAt?: number;
  isHighlighted?: boolean;
  onClick?: () => void;
}

export function TraceEventRow({ event, runStartedAt, isHighlighted, onClick }: TraceEventRowProps) {
  const Icon = ICON_BY_TYPE[event.type];
  const clickable = onClick != null;
  const Tag = clickable ? "button" : "div";

  return (
    <Tag
      type={clickable ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-1 text-left text-xs transition-colors",
        clickable && "hover:bg-accent/40",
        isHighlighted && "border-primary/30 bg-primary/5",
      )}
    >
      <Clock className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
      <span className="mt-0.5 w-16 shrink-0 font-mono text-[10px] text-muted-foreground">
        {formatTimestamp(event.timestamp, runStartedAt)}
      </span>
      <Icon className={cn("mt-0.5 size-3 shrink-0", TONE_BY_TYPE[event.type])} />
      <span className="min-w-0 flex-1 truncate text-foreground">{describe(event)}</span>
      <span className="font-mono text-[10px] text-muted-foreground">#{event.seq}</span>
    </Tag>
  );
}
