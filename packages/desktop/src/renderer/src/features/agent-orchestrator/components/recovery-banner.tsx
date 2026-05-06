/**
 * RecoveryBanner — surfaces interrupted runs from previous sessions and
 * offers a strategy picker (resume_from_checkpoint / restart_failed_stage
 * / skip_failed_stage / abort) so the user can resume work after a crash
 * or hard quit.
 */

import { LifeBuoy, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ResumeStrategy } from "../../../../../shared/features/agent-orchestrator/types";

import { Button } from "../../../components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { useOrchestratorStore } from "../store";

const STRATEGIES: ResumeStrategy[] = [
  "resume_from_checkpoint",
  "restart_failed_stage",
  "skip_failed_stage",
  "abort",
];

export function RecoveryBanner() {
  const { t } = useTranslation();
  const recoverableRuns = useOrchestratorStore((s) => s.recoverableRuns);
  const loadRecoverable = useOrchestratorStore((s) => s.loadRecoverable);
  const resume = useOrchestratorStore((s) => s.resumeRunWithStrategy);
  const resumingRunIds = useOrchestratorStore((s) => s.resumingRunIds);

  useEffect(() => {
    void loadRecoverable();
  }, [loadRecoverable]);

  const [strategyByRun, setStrategyByRun] = useState<Record<string, ResumeStrategy>>({});

  if (recoverableRuns.length === 0) return null;

  return (
    <div className="mx-3 mb-2 rounded-md border border-warning/40 bg-warning/5 p-3">
      <div className="mb-2 flex items-center gap-2">
        <LifeBuoy className="size-4 text-warning-foreground" />
        <h4 className="text-xs font-semibold text-foreground">
          {t("orchestrator.recovery.title")}
        </h4>
      </div>
      <p className="mb-2 text-[11px] text-muted-foreground">
        {t("orchestrator.recovery.description", { count: recoverableRuns.length })}
      </p>
      <ul className="space-y-2">
        {recoverableRuns.map((r) => {
          const strategy = strategyByRun[r.runId] ?? "resume_from_checkpoint";
          const isResuming = Boolean(resumingRunIds[r.runId]);
          return (
            <li
              key={r.runId}
              className="space-y-1.5 rounded border border-border bg-background p-2"
            >
              <div className="truncate text-[11px] font-mono text-muted-foreground">
                {r.runId.slice(0, 12)} · {r.templateId}
              </div>
              <div className="flex items-center gap-1.5">
                <Select
                  value={strategy}
                  onValueChange={(v) =>
                    setStrategyByRun((prev) => ({ ...prev, [r.runId]: v as ResumeStrategy }))
                  }
                >
                  <SelectTrigger size="sm" className="h-7 flex-1 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {STRATEGIES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`orchestrator.recovery.strategy.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2"
                  disabled={isResuming}
                  onClick={() => void resume(r.runId, strategy)}
                >
                  <RotateCw className={isResuming ? "size-3 animate-spin" : "size-3"} />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
