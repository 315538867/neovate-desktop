import type { StageRunRecord } from "../../../../../shared/features/agent-orchestrator/schemas";

import { cn } from "../../../lib/utils";

type Props = {
  children: StageRunRecord[];
  className?: string;
};

export function FanoutTimeline({ children, className }: Props) {
  if (children.length === 0) return null;

  return (
    <div className={cn("space-y-1", className)} aria-label="Fan-out timeline">
      <p className="px-2 text-[10px] text-muted-foreground">
        Fan-out — {children.length} parallel stages
      </p>
      <div className="ml-3 space-y-0.5 border-l border-border pl-3">
        {children.map((child) => (
          <div
            key={child.instanceId}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs"
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                child.status === "completed" && "bg-green-500",
                child.status === "running" && "bg-yellow-400 animate-pulse",
                child.status === "failed" && "bg-red-500",
                child.status === "pending" && "bg-muted-foreground/30",
              )}
            />
            <span className="truncate text-muted-foreground">Fan-out #{child.fanOutIndex}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
