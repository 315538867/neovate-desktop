/**
 * GateApproval — inline panel that surfaces user-gate decisions on the
 * active run. Shown when `activeRun.status === "paused_user_gate"`. The
 * user picks Approve or Reject, optionally records a note, then the store
 * action ferries the call to `client.agent.orchestrator.approveGate`.
 */

import { CheckCircle2, ShieldAlert, XCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../../components/ui/button";
import { Textarea } from "../../../components/ui/textarea";
import { useOrchestratorStore } from "../store";

export interface GateApprovalProps {
  runId: string;
  stageId: string;
}

export function GateApproval({ runId, stageId }: GateApprovalProps) {
  const { t } = useTranslation();
  const approveGate = useOrchestratorStore((s) => s.approveGate);
  const pendingKey = `${runId}:${stageId}`;
  const isPending = useOrchestratorStore((s) => Boolean(s.approvingGateIds[pendingKey]));

  const [note, setNote] = useState("");

  const handle = async (approved: boolean) => {
    await approveGate(runId, stageId, approved, note.trim() || undefined);
  };

  return (
    <section className="mb-6 rounded-md border border-warning/40 bg-warning/5 p-4">
      <header className="mb-2 flex items-center gap-2">
        <ShieldAlert className="size-4 text-warning-foreground" />
        <h3 className="text-sm font-semibold text-foreground">{t("orchestrator.gate.title")}</h3>
      </header>
      <p className="mb-3 text-xs text-muted-foreground">{t("orchestrator.gate.description")}</p>
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t("orchestrator.gate.notePlaceholder")}
        rows={2}
        className="mb-3 text-xs"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void handle(true)} disabled={isPending}>
          <CheckCircle2 className="size-3.5" />
          {t("orchestrator.action.approve")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void handle(false)} disabled={isPending}>
          <XCircle className="size-3.5" />
          {t("orchestrator.action.reject")}
        </Button>
      </div>
    </section>
  );
}
