/**
 * RunCard — compact summary tile for one orchestrator run.
 *
 * Used in the side list of `OrchestratorPanel`. Shows status, template id,
 * progress (completedStageCount / totalStageCount), and elapsed time.
 * Pure presentational; the parent owns selection state.
 */

import type { ComponentProps } from "react";

import { cva, type VariantProps } from "class-variance-authority";

import type {
  RunStatus,
  RunSummary,
} from "../../../../../shared/features/agent-orchestrator/types";

import { Badge } from "../../../components/ui/badge";
import { cn } from "../../../lib/utils";

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

const STATUS_VARIANT: Record<RunStatus, BadgeVariant> = {
  pending: "outline",
  running: "info",
  paused_user_gate: "warning",
  completed: "success",
  failed: "error",
  cancelled: "secondary",
  interrupted_graceful: "warning",
  interrupted_unsafe: "error",
};

const STATUS_LABEL: Record<RunStatus, string> = {
  pending: "Pending",
  running: "Running",
  paused_user_gate: "User gate",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted_graceful: "Interrupted",
  interrupted_unsafe: "Interrupted",
};

const cardVariants = cva(
  "w-full rounded-md border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  {
    defaultVariants: { selected: false },
    variants: {
      selected: {
        true: "bg-accent/50 border-primary/30",
        false: "",
      },
    },
  },
);

export interface RunCardProps
  extends
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type">,
    VariantProps<typeof cardVariants> {
  run: RunSummary;
  selected?: boolean;
}

function formatElapsed(startedAt: number, completedAt?: number): string {
  const end = completedAt ?? Date.now();
  const ms = Math.max(0, end - startedAt);
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

export function RunCard({ run, selected, className, ...props }: RunCardProps) {
  const elapsed = formatElapsed(run.startedAt, run.completedAt);
  const total = run.totalStageCount || 0;
  const done = run.completedStageCount || 0;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <button type="button" className={cn(cardVariants({ selected }), className)} {...props}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-foreground">{run.templateId}</span>
        <Badge size="sm" variant={STATUS_VARIANT[run.status]}>
          {STATUS_LABEL[run.status]}
        </Badge>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate font-mono">{run.id.slice(0, 8)}</span>
        <span>{elapsed}</span>
      </div>
      {total > 0 && (
        <div className="mt-2">
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full bg-primary transition-all",
                run.status === "failed" && "bg-destructive",
                run.status === "completed" && "bg-success",
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>
              {done} / {total} stages
            </span>
            <span>{progress}%</span>
          </div>
        </div>
      )}
    </button>
  );
}
