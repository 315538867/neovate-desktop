import { AlertTriangle, Layers, Lock, Unlock } from "lucide-react";
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
import { useGroupsStore, useProjectStore } from "../../project/store";
import { groupColor } from "../../project/utils/group-color";
import { useAgentStore } from "../store";

type PendingAction = { type: "revoke"; projectId: string } | null;

export function GroupFocusBar({ session }: { session: ChatSession }) {
  const { t } = useTranslation();
  const groups = useGroupsStore((s) => s.groups);
  const projects = useProjectStore((s) => s.projects);
  const addElevatedProject = useAgentStore((s) => s.addElevatedProject);
  const revokeElevation = useAgentStore((s) => s.revokeElevation);
  const group = groups.find((g) => g.id === session.groupId);

  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const color = useMemo(() => (group ? groupColor(group.id) : undefined), [group?.id]);

  if (!group || session.kind !== "group") return null;

  const members = group.members;
  const elevatedIds = session.elevatedProjectIds ?? [];

  const pendingProject =
    pendingAction?.type === "revoke"
      ? projects.find((p) => p.id === pendingAction.projectId)
      : undefined;
  const pendingMember =
    pendingAction?.type === "revoke"
      ? members.find((m) => m.projectId === pendingAction.projectId)
      : undefined;

  const handleConfirm = async () => {
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;
    if (action.type === "revoke") {
      if (session.sessionId) {
        await revokeElevation(session.sessionId, action.projectId);
      }
    }
  };

  return (
    <>
      <div className="flex flex-col gap-2 border-b px-4 py-2" data-test-id="group-focus-bar">
        <div className="flex items-center gap-1.5 text-xs">
          <Layers size={12} strokeWidth={1.5} className="text-muted-foreground" />
          <span className="font-medium text-foreground/80">{group.name}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground">
            <Lock size={10} strokeWidth={1.75} />
            {t("group.readOnlyChip", "全只读")}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {members.map((m) => {
            const project = projects.find((p) => p.id === m.projectId);
            const isMissing = !project;
            const isElevated = elevatedIds.includes(m.projectId);

            if (isMissing) {
              return (
                <span
                  key={m.projectId}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-border/50 bg-muted/30 px-2 py-0.5 text-xs text-muted-foreground/50 line-through"
                  title={t("group.memberMissing")}
                >
                  <AlertTriangle size={10} strokeWidth={1.5} />
                  {m.projectId}
                </span>
              );
            }

            if (isElevated) {
              return (
                <button
                  key={m.projectId}
                  type="button"
                  className="inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors"
                  style={{
                    backgroundColor: `hsl(${color?.hue ?? 0} 28% 92%)`,
                    color: `hsl(${color?.hue ?? 0} 35% 30%)`,
                  }}
                  onClick={() => setPendingAction({ type: "revoke", projectId: m.projectId })}
                  title={t("group.elevatedTooltip", "本会话已放行写权限，点击撤销")}
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: `hsl(${color?.hue ?? 0} 50% 42%)` }}
                  />
                  {project?.name ?? m.projectId}
                  <Unlock size={10} strokeWidth={1.75} />
                </button>
              );
            }

            return (
              <button
                key={m.projectId}
                type="button"
                data-test-id="member-chip"
                className="inline-flex cursor-pointer items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                onClick={() => addElevatedProject(session.sessionId, m.projectId)}
                title={t("group.elevateTooltip", "授予 {{name}} 写权限", {
                  name: project?.name ?? m.projectId,
                })}
              >
                {project?.name ?? m.projectId}
              </button>
            );
          })}
          {members.length === 0 && (
            <span className="text-xs text-muted-foreground/50">{t("group.noMembers")}</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
          {elevatedIds.length > 0 ? (
            <>
              <Unlock size={10} strokeWidth={1.5} />
              <span>
                {t("group.readOnlyWithElevations", {
                  names: elevatedIds
                    .map((id) => projects.find((p) => p.id === id)?.name ?? id)
                    .join("、"),
                })}
              </span>
            </>
          ) : (
            <>
              <Lock size={10} strokeWidth={1.5} />
              <span>
                {t(
                  "group.readOnlyHint",
                  "全只读模式：禁止 Edit/Write/MultiEdit/NotebookEdit，仅允许 Read/Grep/Glob",
                )}
              </span>
            </>
          )}
        </div>
      </div>

      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("group.revokeElevationTitle", {
                name: pendingProject?.name ?? pendingMember?.projectId ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("group.revokeElevationDescription", {
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
            <Button size="sm" onClick={handleConfirm}>
              {t("group.switch")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
