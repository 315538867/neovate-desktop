/**
 * StartRunDialog — controlled dialog that lets the user pick a template,
 * confirm the working directory, and (optionally) override the variables
 * map before kicking off `client.agent.orchestrator.startRun`.
 *
 * The dialog defers all error handling to the store action thunk; it just
 * closes itself on a non-`undefined` result.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Textarea } from "../../../components/ui/textarea";
import { useProjectStore } from "../../project/store";
import { useOrchestratorStore } from "../store";

export interface StartRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StartRunDialog({ open, onOpenChange }: StartRunDialogProps) {
  const { t } = useTranslation();
  const templates = useOrchestratorStore((s) => s.templates);
  const isStarting = useOrchestratorStore((s) => s.isStartingRun);
  const startRun = useOrchestratorStore((s) => s.startRun);
  const activeProject = useProjectStore((s) => s.activeProject);

  const defaultCwd = activeProject?.path ?? "";

  const [templateId, setTemplateId] = useState<string>("");
  const [cwd, setCwd] = useState<string>(defaultCwd);
  const [variablesText, setVariablesText] = useState<string>("{}");
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Reset form when the dialog opens.
  useEffect(() => {
    if (!open) return;
    setTemplateId(templates[0]?.id ?? "");
    setCwd(defaultCwd);
    setVariablesText("{}");
    setJsonError(null);
  }, [open, templates, defaultCwd]);

  const canSubmit = useMemo(
    () => Boolean(templateId) && cwd.trim().length > 0 && !isStarting,
    [templateId, cwd, isStarting],
  );

  const handleSubmit = async () => {
    let variables: Record<string, string> | undefined;
    const trimmed = variablesText.trim();
    if (trimmed && trimmed !== "{}") {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (
          !parsed ||
          typeof parsed !== "object" ||
          Array.isArray(parsed) ||
          Object.values(parsed).some((v) => typeof v !== "string")
        ) {
          setJsonError(t("orchestrator.startDialog.invalidJson"));
          return;
        }
        variables = parsed as Record<string, string>;
      } catch {
        setJsonError(t("orchestrator.startDialog.invalidJson"));
        return;
      }
    }
    setJsonError(null);
    const run = await startRun({
      templateId,
      cwd: cwd.trim(),
      variables,
      projectId: activeProject?.id,
    });
    if (run) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("orchestrator.startDialog.title")}</DialogTitle>
          <DialogDescription>{t("orchestrator.startDialog.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 pb-2">
          <div className="space-y-1.5">
            <Label htmlFor="orchestrator-template">{t("orchestrator.startDialog.template")}</Label>
            {templates.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("orchestrator.startDialog.noTemplates")}
              </p>
            ) : (
              <Select value={templateId} onValueChange={(v) => setTemplateId(v as string)}>
                <SelectTrigger id="orchestrator-template" size="sm" className="w-full">
                  <SelectValue placeholder={t("orchestrator.startDialog.templatePlaceholder")} />
                </SelectTrigger>
                <SelectPopup>
                  {templates.map((tpl) => (
                    <SelectItem key={tpl.id} value={tpl.id}>
                      {tpl.name ?? tpl.id}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="orchestrator-cwd">{t("orchestrator.startDialog.cwd")}</Label>
            <Input
              id="orchestrator-cwd"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder={t("orchestrator.startDialog.cwdPlaceholder")}
            />
            <p className="text-[11px] text-muted-foreground">
              {t("orchestrator.startDialog.cwdHint")}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="orchestrator-vars">{t("orchestrator.startDialog.variables")}</Label>
            <Textarea
              id="orchestrator-vars"
              value={variablesText}
              onChange={(e) => setVariablesText(e.target.value)}
              rows={4}
              className="font-mono text-xs"
            />
            {jsonError && <p className="text-xs text-destructive-foreground">{jsonError}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("orchestrator.action.dismiss")}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {isStarting ? t("orchestrator.action.starting") : t("orchestrator.action.start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
