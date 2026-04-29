import { useCallback, useEffect, useState } from "react";

import type { PipelineTemplate } from "../../../../../shared/features/agent-orchestrator/schemas";

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
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Textarea } from "../../../components/ui/textarea";
import { useOrchestrator } from "../hooks/use-orchestrator";
import { useOrchestratorStore } from "../store";

type Props = {
  workspacePath: string;
};

export function LauncherDialog({ workspacePath }: Props) {
  const launcherOpen = useOrchestratorStore((s) => s.launcherOpen);
  const setLauncherOpen = useOrchestratorStore((s) => s.setLauncherOpen);
  const { startRun, listTemplates } = useOrchestrator();

  const [templates, setTemplates] = useState<PipelineTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [userPrompt, setUserPrompt] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (launcherOpen) {
      listTemplates()
        .then(setTemplates)
        .catch(() => {});
    }
  }, [launcherOpen, listTemplates]);

  const handleLaunch = useCallback(async () => {
    if (!selectedTemplate || !userPrompt.trim()) return;
    setLoading(true);
    try {
      await startRun({
        templateId: selectedTemplate,
        workspacePath,
        userPrompt: userPrompt.trim(),
      });
      setLauncherOpen(false);
      setUserPrompt("");
    } catch {
      // 错误由 ErrorDrawer 处理
    } finally {
      setLoading(false);
    }
  }, [selectedTemplate, userPrompt, workspacePath, startRun, setLauncherOpen]);

  const valid = selectedTemplate && userPrompt.trim();

  return (
    <Dialog open={launcherOpen} onOpenChange={setLauncherOpen}>
      <DialogContent className="max-w-lg" aria-describedby="launcher-description">
        <DialogHeader>
          <DialogTitle>Start Orchestrated Pipeline</DialogTitle>
          <DialogDescription id="launcher-description">
            Select a template and describe what you want to build.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="launcher-template">Template</Label>
            <Select value={selectedTemplate} onValueChange={(v) => setSelectedTemplate(v ?? "")}>
              <SelectTrigger id="launcher-template">
                <SelectValue placeholder="Select a pipeline template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <span className="font-medium">{t.displayName}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{t.description}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="launcher-prompt">Task Description</Label>
            <Textarea
              id="launcher-prompt"
              placeholder="Describe what you want to build..."
              rows={4}
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="launcher-workspace">Workspace</Label>
            <Input id="launcher-workspace" value={workspacePath} disabled />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setLauncherOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleLaunch}
            disabled={!valid || loading}
            className="bg-[#fa216e] hover:bg-[#fa216e]/90"
          >
            {loading ? "Launching..." : "Launch Pipeline"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
