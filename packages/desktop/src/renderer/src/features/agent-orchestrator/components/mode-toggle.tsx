import { useCallback } from "react";

import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import { useOrchestratorStore } from "../store";

type Props = {
  className?: string;
};

export function ModeToggle({ className }: Props) {
  const mode = useOrchestratorStore((s) => s.mode);
  const setMode = useOrchestratorStore((s) => s.setMode);

  const toggle = useCallback(() => {
    setMode(mode === "standard" ? "orchestrated" : "standard");
  }, [mode, setMode]);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-xs text-muted-foreground">Mode</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={toggle}
        aria-label={`Switch to ${mode === "standard" ? "orchestrated" : "standard"} mode`}
      >
        <span
          className={cn(
            "text-xs font-medium transition-colors",
            mode === "orchestrated" ? "text-[#fa216e]" : "text-muted-foreground",
          )}
        >
          {mode === "standard" ? "Standard" : "Orchestrated"}
        </span>
      </Button>
    </div>
  );
}
