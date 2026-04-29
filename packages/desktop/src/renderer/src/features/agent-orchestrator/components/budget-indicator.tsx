import type { PipelineBudget } from "../../../../../shared/features/agent-orchestrator/schemas";

import { Meter } from "../../../components/ui/meter";
import { cn } from "../../../lib/utils";

type Props = {
  budget?: PipelineBudget;
  className?: string;
};

export function BudgetIndicator({ budget, className }: Props) {
  if (!budget) return null;

  const hasTokens = budget.maxTokens != null && budget.maxTokens > 0;
  const hasCost = budget.maxCost != null && budget.maxCost > 0;
  const hasDuration = budget.maxDurationMs != null && budget.maxDurationMs > 0;

  if (!hasTokens && !hasCost && !hasDuration) {
    return <span className="text-xs text-muted-foreground">No budget set</span>;
  }

  return (
    <div className={cn("space-y-2", className)} aria-label="Budget usage">
      {hasTokens && (
        <div className="space-y-0.5">
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Tokens</span>
            <span>
              {formatNumber(budget.usedTokens)} / {formatNumber(budget.maxTokens!)}
            </span>
          </div>
          <Meter
            value={Math.min((budget.usedTokens / budget.maxTokens!) * 100, 100)}
            aria-label="Token usage"
          />
        </div>
      )}
      {hasCost && (
        <div className="space-y-0.5">
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Cost</span>
            <span>
              ${budget.usedCost.toFixed(4)} / ${budget.maxCost!.toFixed(2)}
            </span>
          </div>
          <Meter
            value={Math.min((budget.usedCost / budget.maxCost!) * 100, 100)}
            aria-label="Cost usage"
          />
        </div>
      )}
      {hasDuration && (
        <div className="space-y-0.5">
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Duration</span>
            <span>
              {formatMs(budget.usedDurationMs)} / {formatMs(budget.maxDurationMs!)}
            </span>
          </div>
          <Meter
            value={Math.min((budget.usedDurationMs / budget.maxDurationMs!) * 100, 100)}
            aria-label="Duration usage"
          />
        </div>
      )}
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatMs(ms: number): string {
  if (ms >= 60_000) return `${Math.round(ms / 60_000)}min`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${ms}ms`;
}
