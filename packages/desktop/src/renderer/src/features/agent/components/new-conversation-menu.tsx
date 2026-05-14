import { ChevronDown, Layers, SquarePen } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useGroupsStore, useProjectStore } from "../../project/store";
import { claudeCodeChatManager } from "../chat-manager";
import { useNewSession } from "../hooks/use-new-session";
import { registerSessionInStore } from "../session-utils";

export function NewConversationMenu({ projectPath }: { projectPath?: string }) {
  const { t } = useTranslation();
  const { createNewSession } = useNewSession();
  const groups = useGroupsStore((s) => s.groups);
  const loadGroups = useGroupsStore((s) => s.loadGroups);
  const projects = useProjectStore((s) => s.projects);
  const [open, setOpen] = useState(false);

  // Ensure groups are loaded when the component mounts
  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);
  const [step, setStep] = useState<"menu" | "selectGroup">("menu");
  const [creating, setCreating] = useState(false);

  const hasGroups = groups.length > 0;

  const handleNewSingleSession = () => {
    setOpen(false);
    setStep("menu");
    if (projectPath) createNewSession(projectPath);
  };

  const handleSelectGroup = async (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;

    setCreating(true);
    try {
      // Pick first non-missing member's path as cwd
      let cwd: string | undefined;
      for (const m of group.members) {
        const project = projects.find((p) => p.id === m.projectId);
        if (project) {
          cwd = project.path;
          break;
        }
      }
      if (!cwd) return; // all members missing

      const { sessionId, commands, models, currentModel, modelScope, providerId } =
        await claudeCodeChatManager.createSession(cwd, {
          kind: "group",
          groupId,
        });

      registerSessionInStore(
        sessionId,
        cwd,
        { commands, models, currentModel, modelScope, providerId },
        true,
        {
          kind: "group",
          groupId,
        },
      );

      setOpen(false);
      setStep("menu");
    } finally {
      setCreating(false);
    }
  };

  const handleBack = () => {
    setStep("menu");
  };

  return (
    <div className="relative">
      <button
        className="group flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-accent/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        data-test-id="new-conversation-menu"
        onClick={() => {
          if (!hasGroups) {
            handleNewSingleSession();
          } else {
            setOpen(!open);
            setStep("menu");
          }
        }}
        disabled={!projectPath}
      >
        <SquarePen
          size={16}
          strokeWidth={1.75}
          className="shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
        />
        <span className="flex-1 text-left">{t("session.newChat")}</span>
        {hasGroups && (
          <ChevronDown
            size={14}
            strokeWidth={1.75}
            className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {open && hasGroups && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border bg-popover p-1 shadow-md">
            {step === "menu" && (
              <>
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                  onClick={handleNewSingleSession}
                >
                  <SquarePen size={14} strokeWidth={1.5} />
                  {t("session.newChat")}
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-40"
                  data-test-id="new-group-conversation"
                >
                  <Layers size={14} strokeWidth={1.5} />
                  {t("project.groupChat", "在分组里聊")}
                </button>
              </>
            )}

            {step === "selectGroup" && (
              <>
                <div className="flex items-center gap-1 px-2 py-1">
                  <button
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                    onClick={handleBack}
                  >
                    <ChevronDown size={14} strokeWidth={1.5} className="rotate-90" />
                  </button>
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("project.selectGroup", "选择分组")}
                  </span>
                </div>
                <div className="my-1 h-px bg-border" />
                {groups.map((g) => (
                  <button
                    key={g.id}
                    data-test-id="group-select-item"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-40"
                    onClick={() => handleSelectGroup(g.id)}
                    disabled={creating}
                  >
                    <Layers size={14} strokeWidth={1.5} />
                    <span>{g.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {g.members.length}
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
