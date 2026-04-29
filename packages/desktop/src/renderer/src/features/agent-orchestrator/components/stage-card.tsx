import { CheckCircle, CancelCircleIcon, Clock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type {
  StageRunRecord,
  StageRunStatus,
} from "../../../../../shared/features/agent-orchestrator/schemas";

import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";

type Props = {
  stage: StageRunRecord;
  stageLabel: string;
  isActive: boolean;
  isExpanded: boolean;
  onExpand: () => void;
};

const statusIcon: Record<StageRunStatus, React.ReactNode> = {
  pending: <HugeiconsIcon icon={Clock01Icon} className="size-3 text-muted-foreground" />,
  running: <span className="size-2 animate-pulse rounded-full bg-yellow-400" />,
  awaiting_user: <span className="size-2 rounded-full bg-blue-400" />,
  completed: <HugeiconsIcon icon={CheckCircle} className="size-3 text-green-500" />,
  failed: <HugeiconsIcon icon={CancelCircleIcon} className="size-3 text-red-500" />,
  paused: <HugeiconsIcon icon={Clock01Icon} className="size-3 text-yellow-400" />,
  interrupted_graceful: <HugeiconsIcon icon={Clock01Icon} className="size-3 text-yellow-400" />,
  interrupted_crashed: <HugeiconsIcon icon={CancelCircleIcon} className="size-3 text-red-500" />,
  stalled: <HugeiconsIcon icon={Clock01Icon} className="size-3 text-orange-400" />,
  skipped: <span className="size-2 rounded-full bg-muted-foreground/30" />,
};

const statusLabel: Record<StageRunStatus, string> = {
  pending: "Pending",
  running: "Running",
  awaiting_user: "Awaiting Review",
  completed: "Completed",
  failed: "Failed",
  paused: "Paused",
  interrupted_graceful: "Interrupted",
  interrupted_crashed: "Crashed",
  stalled: "Stalled",
  skipped: "Skipped",
};

export function StageCard({ stage, stageLabel, isActive, isExpanded, onExpand }: Props) {
  return (
    <Button
      variant="ghost"
      onClick={onExpand}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors",
        isActive && "ring-1 ring-[#fa216e]/30",
        isExpanded && "bg-accent",
      )}
      aria-label={`${stageLabel} - ${statusLabel[stage.status]}`}
      aria-expanded={isExpanded}
    >
      <span className="shrink-0">{statusIcon[stage.status]}</span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{stageLabel}</span>
      <Badge
        variant="secondary"
        className={cn(
          "shrink-0 text-[10px]",
          stage.status === "completed" && "border-green-500/30 text-green-500",
          stage.status === "failed" && "border-red-500/30 text-red-500",
          stage.status === "awaiting_user" && "border-blue-400/30 text-blue-400",
        )}
      >
        {statusLabel[stage.status]}
      </Badge>
      {stage.attempt > 0 && (
        <span className="shrink-0 text-[10px] text-muted-foreground">#{stage.attempt}</span>
      )}
    </Button>
  );
}
