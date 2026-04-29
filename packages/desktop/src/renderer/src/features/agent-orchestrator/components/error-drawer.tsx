import { useState } from "react";

import type {
  StageError,
  StageRunRecord,
} from "../../../../../shared/features/agent-orchestrator/schemas";

import { Badge } from "../../../components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../../components/ui/sheet";
import { cn } from "../../../lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  stage?: StageRunRecord;
  stageLabel?: string;
};

const levelBadge: Record<string, { label: string; className: string }> = {
  L0: { label: "L0", className: "border-blue-400/30 text-blue-400" },
  L1: { label: "L1", className: "border-yellow-400/30 text-yellow-400" },
  L2: { label: "L2", className: "border-orange-400/30 text-orange-400" },
  L3: { label: "L3", className: "border-red-500/30 text-red-500" },
  L4: { label: "L4", className: "border-red-500/30 text-red-500" },
};

export function ErrorDrawer({ open, onClose, stage, stageLabel }: Props) {
  const errors = stage?.errors ?? [];

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-96" aria-label="Error details">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <SheetTitle>Error History</SheetTitle>
          </div>
          {stageLabel && (
            <p className="text-xs text-muted-foreground">
              {stageLabel} (attempt {stage?.attempt ?? 0})
            </p>
          )}
        </SheetHeader>

        <div className="mt-4 space-y-2">
          {errors.length === 0 ? (
            <p className="text-xs text-muted-foreground">No errors recorded.</p>
          ) : (
            errors.map((err, i) => <ErrorItem key={i} error={err} />)
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ErrorItem({ error }: { error: StageError }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = levelBadge[error.level] ?? levelBadge.L2;

  return (
    <div
      className="cursor-pointer rounded border border-border bg-muted/30 p-2 text-xs"
      onClick={() => setExpanded(!expanded)}
      aria-expanded={expanded}
    >
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className={cn("text-[9px]", cfg.className)}>
          {cfg.label}
        </Badge>
        <code className="flex-1 truncate text-[11px]">{error.code}</code>
        <span className="text-[10px] text-muted-foreground">
          {new Date(error.timestamp).toLocaleTimeString()}
        </span>
      </div>
      {expanded && (
        <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
          {error.providerMessage && (
            <div>
              <span className="text-muted-foreground">Message: </span>
              <span className="text-muted-foreground/80">{error.providerMessage}</span>
            </div>
          )}
          {error.cause && (
            <div>
              <span className="text-muted-foreground">Cause: </span>
              <code className="text-[10px]">{error.cause}</code>
            </div>
          )}
          {error.httpStatus != null && (
            <div>
              <span className="text-muted-foreground">HTTP: </span>
              <span>{error.httpStatus}</span>
            </div>
          )}
          {error.retryAfter != null && (
            <div>
              <span className="text-muted-foreground">Retry after: </span>
              <span>{error.retryAfter}s</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
