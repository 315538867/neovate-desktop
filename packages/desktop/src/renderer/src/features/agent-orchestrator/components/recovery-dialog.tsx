import { useCallback, useState } from "react";

import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { cn } from "../../../lib/utils";
import { useOrchestrator } from "../hooks/use-orchestrator";
import { useOrchestratorStore } from "../store";

type RecoveryOption = {
  action: "restart" | "resume-with-context" | "skip-to-next" | "terminate";
  label: string;
  description: string;
};

const recoveryOptions: RecoveryOption[] = [
  {
    action: "restart",
    label: "Restart",
    description: "Restart the stage from the beginning with a fresh session.",
  },
  {
    action: "resume-with-context",
    label: "Resume with Context",
    description: "Continue from where it left off using partial output and checkpoint.",
  },
  {
    action: "skip-to-next",
    label: "Skip to Next",
    description: "Skip this stage and move to the next one.",
  },
  {
    action: "terminate",
    label: "Terminate",
    description: "Cancel the entire run.",
  },
];

type Props = {
  runId: string;
  instanceId: string;
  reason: string;
};

export function RecoveryDialog({ runId, instanceId, reason }: Props) {
  const recoveryOpen = useOrchestratorStore((s) => s.recoveryDialogOpen);
  const setRecoveryOpen = useOrchestratorStore((s) => s.setRecoveryDialogOpen);
  const { resumeRunWithStrategy } = useOrchestrator();
  const [selected, setSelected] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const handleConfirm = useCallback(async () => {
    if (!selected) return;
    setActing(true);
    try {
      await resumeRunWithStrategy(runId, instanceId, selected);
      setRecoveryOpen(false);
      setSelected(null);
    } finally {
      setActing(false);
    }
  }, [selected, runId, instanceId, resumeRunWithStrategy, setRecoveryOpen]);

  return (
    <Dialog open={recoveryOpen} onOpenChange={setRecoveryOpen}>
      <DialogContent className="max-w-sm" aria-describedby="recovery-description">
        <DialogHeader>
          <DialogTitle>Recovery Required</DialogTitle>
          <DialogDescription id="recovery-description">
            An interrupted run needs your attention.
          </DialogDescription>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">{reason}</p>

        <div className="space-y-1">
          {recoveryOptions.map((opt) => (
            <button
              key={opt.action}
              onClick={() => setSelected(opt.action)}
              className={cn(
                "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                selected === opt.action
                  ? "border-[#fa216e] bg-[#fa216e]/5"
                  : "border-border hover:bg-accent",
              )}
              aria-label={opt.label}
            >
              <div className="text-xs font-medium">{opt.label}</div>
              <div className="text-[11px] text-muted-foreground">{opt.description}</div>
            </button>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setRecoveryOpen(false)}>
            Dismiss
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={!selected || acting}
            className="bg-[#fa216e] hover:bg-[#fa216e]/90"
          >
            {acting ? "Applying..." : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
