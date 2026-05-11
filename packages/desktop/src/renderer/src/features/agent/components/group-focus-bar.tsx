import { AlertTriangle, Layers, Lock } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ChatSession } from "../store";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";
import { Button } from "../../../components/ui/button";
import { client } from "../../../orpc";
import { useGroupsStore, useProjectStore } from "../../project/store";
import { groupColor } from "../../project/utils/group-color";
import { useAgentStore } from "../store";

/** A chip for a single group member, with optional missing-path styling. */
function MemberChip({
  projectName,
  projectId,
  isFocus,
  isMissing,
  hue,
  onClick,
  title,
}: {
  projectName?: string;
  projectId: string;
  isFocus: boolean;
  isMissing: boolean;
  hue: number;
  onClick?: () => void;
  title?: string;
}) {
  if (isMissing) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-border/50 bg-muted/30 px-2 py-0.5 text-xs text-muted-foreground/50 line-through"
        title={title}
      >
        <AlertTriangle size={10} strokeWidth={1.5} />
        {projectName ?? projectId}
      </span>
    );
  }

  if (isFocus) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
        style={{ backgroundColor: `hsl(${hue} 28% 92%)`, color: `hsl(${hue} 35% 30%)` }}
      >
        <span
          className="size-1.5 rounded-full"
          style={{ backgroundColor: `hsl(${hue} 50% 42%)` }}
        />
        {projectName ?? projectId}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="inline-flex cursor-pointer items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
      onClick={onClick}
      title={title}
    >
      {projectName ?? projectId}
    </button>
  );
}

export function GroupFocusBar({ session }: { session: ChatSession }) {
  const { t } = useTranslation();
  const groups = useGroupsStore((s) => s.groups);
  const projects = useProjectStore((s) => s.projects);
  const setFocusProject = useAgentStore((s) => s.setFocusProject);
  const group = groups.find((g) => g.id === session.groupId);

  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);

  const color = useMemo(() => (group ? groupColor(group.id) : undefined), [group?.id]);

  if (!group || session.kind !== "group") return null;

  const members = group.members;
  const focusMember = members.find((m) => m.projectId === session.focusProjectId);
  const otherMembers = members.filter((m) => m.projectId !== session.focusProjectId);
  const focusProject = focusMember
    ? projects.find((p) => p.id === focusMember.projectId)
    : undefined;
  const focusIsMissing = focusMember
    ? !projects.find((p) => p.id === focusMember.projectId)
    : false;

  const pendingProject = pendingSwitch ? projects.find((p) => p.id === pendingSwitch) : undefined;
  const pendingMember = pendingSwitch
    ? members.find((m) => m.projectId === pendingSwitch)
    : undefined;

  const handleSwitchConfirm = async () => {
    if (!pendingSwitch || !session.sessionId) return;
    const targetId = pendingSwitch;
    setPendingSwitch(null);

    // Optimistic update
    setFocusProject(session.sessionId, targetId);

    try {
      await client.agent.session.setFocusProject({
        sessionId: session.sessionId,
        projectId: targetId,
      });
    } catch {
      // Revert on failure
      setFocusProject(session.sessionId, session.focusProjectId ?? "");
    }
  };

  return (
    <>
      <div className="flex flex-col gap-2 border-b px-4 py-2">
        <div className="flex items-center gap-1.5 text-xs">
          <Layers size={12} strokeWidth={1.5} className="text-muted-foreground" />
          <span className="font-medium text-foreground/80">{group.name}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {focusMember && (
            <MemberChip
              projectId={focusMember.projectId}
              projectName={focusProject?.name}
              isFocus
              isMissing={focusIsMissing}
              hue={color?.hue ?? 0}
            />
          )}
          {otherMembers.map((m) => {
            const project = projects.find((p) => p.id === m.projectId);
            const isMissing = !project;
            return (
              <MemberChip
                key={m.projectId}
                projectId={m.projectId}
                projectName={project?.name}
                isFocus={false}
                isMissing={isMissing}
                hue={color?.hue ?? 0}
                onClick={isMissing ? undefined : () => setPendingSwitch(m.projectId)}
                title={
                  isMissing
                    ? t("group.memberMissing")
                    : t("group.switchFocusTo", { name: project?.name ?? m.projectId })
                }
              />
            );
          })}
          {members.length === 0 && (
            <span className="text-xs text-muted-foreground/50">{t("group.noMembers")}</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
          {focusIsMissing ? (
            <AlertTriangle size={10} strokeWidth={1.5} className="text-destructive/60" />
          ) : (
            <Lock size={10} strokeWidth={1.5} />
          )}
          <span>
            {focusIsMissing
              ? t("group.focusMissing")
              : focusMember
                ? t("group.writeScope", { name: focusProject?.name ?? focusMember.projectId })
                : t("group.writeScopeNoFocus")}
          </span>
        </div>
      </div>

      <AlertDialog
        open={pendingSwitch !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSwitch(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("group.switchFocusTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("group.switchFocusDescription", {
                name: pendingProject?.name ?? pendingMember?.projectId ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose>
              <Button variant="outline" size="sm">
                {t("group.cancel")}
              </Button>
            </AlertDialogClose>
            <Button size="sm" onClick={handleSwitchConfirm}>
              {t("group.switch")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
