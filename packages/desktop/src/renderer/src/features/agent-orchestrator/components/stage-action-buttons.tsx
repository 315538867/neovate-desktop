import {
  Cancel01Icon,
  CheckmarkCircle01Icon,
  RefreshIcon,
  SquareArrowRight02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useState } from "react";

import type { StageRunStatus } from "../../../../../shared/features/agent-orchestrator/schemas";

import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import { useOrchestrator } from "../hooks/use-orchestrator";

type Props = {
  runId: string;
  instanceId: string;
  stageStatus: StageRunStatus;
  className?: string;
};

export function StageActionButtons({ runId, instanceId, stageStatus, className }: Props) {
  const { approveStage, retryStage, skipStage, cancelRun } = useOrchestrator();
  const [acting, setActing] = useState<string | null>(null);

  const handleAction = useCallback(
    async (action: string) => {
      setActing(action);
      try {
        switch (action) {
          case "approve":
            await approveStage(runId, instanceId);
            break;
          case "retry":
            await retryStage(runId, instanceId);
            break;
          case "skip":
            await skipStage(runId, instanceId);
            break;
          case "cancel":
            await cancelRun(runId);
            break;
        }
      } finally {
        setActing(null);
      }
    },
    [runId, instanceId, approveStage, retryStage, skipStage, cancelRun],
  );

  const showApprove = stageStatus === "awaiting_user";
  const showRetry = stageStatus === "failed" || stageStatus === "interrupted_crashed";
  const showSkip = stageStatus === "awaiting_user" || stageStatus === "failed";
  const showCancel =
    stageStatus === "running" || stageStatus === "awaiting_user" || stageStatus === "paused";

  if (!showApprove && !showRetry && !showSkip && !showCancel) return null;

  return (
    <div className={cn("flex flex-wrap gap-1", className)} aria-label="Stage actions">
      {showApprove && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => handleAction("approve")}
          disabled={acting !== null}
          className="h-7 gap-1 text-[11px] text-green-500 hover:text-green-400"
          aria-label="Approve stage"
        >
          <HugeiconsIcon icon={CheckmarkCircle01Icon} className="size-3" />
          {acting === "approve" ? "Approving..." : "Approve"}
        </Button>
      )}

      {showRetry && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => handleAction("retry")}
          disabled={acting !== null}
          className="h-7 gap-1 text-[11px] text-[#fa216e] hover:text-[#fa216e]/80"
          aria-label="Retry stage"
        >
          <HugeiconsIcon icon={RefreshIcon} className="size-3" />
          {acting === "retry" ? "Retrying..." : "Retry"}
        </Button>
      )}

      {showSkip && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => handleAction("skip")}
          disabled={acting !== null}
          className="h-7 gap-1 text-[11px]"
          aria-label="Skip stage"
        >
          <HugeiconsIcon icon={SquareArrowRight02Icon} className="size-3" />
          {acting === "skip" ? "Skipping..." : "Skip"}
        </Button>
      )}

      {showCancel && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => handleAction("cancel")}
          disabled={acting !== null}
          className="h-7 gap-1 text-[11px] text-red-400 hover:text-red-300"
          aria-label="Cancel run"
        >
          <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
          {acting === "cancel" ? "Cancelling..." : "Cancel"}
        </Button>
      )}
    </div>
  );
}
