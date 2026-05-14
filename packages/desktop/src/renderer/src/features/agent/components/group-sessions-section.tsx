import { ChevronRight, Layers, Lock, Plus, SquarePen } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { UnifiedItem } from "../hooks/use-unified-sessions";

import { useGroupsStore, useProjectStore } from "../../project/store";
import { groupColor } from "../../project/utils/group-color";
import { claudeCodeChatManager } from "../chat-manager";
import { useLoadSession } from "../hooks/use-load-session";
import { useFilteredSessions } from "../hooks/use-unified-sessions";
import { registerSessionInStore } from "../session-utils";
import { useAgentStore } from "../store";
import { UnifiedSessionItem } from "./unified-session-item";

interface GroupSessionsSectionProps {
  items: UnifiedItem[];
  pinnedIds: Set<string>;
  activeSessionId: string | null;
  restoring: string | null;
  onActivate: (sessionId: string, projectPath?: string) => void;
  onLoad: (sessionId: string, projectPath?: string) => void;
}

export function GroupSessionsSection({
  items,
  pinnedIds,
  activeSessionId,
  restoring,
  onActivate,
  onLoad,
}: GroupSessionsSectionProps) {
  const { t } = useTranslation();
  const groups = useGroupsStore((s) => s.groups);
  const projects = useProjectStore((s) => s.projects);
  const sessions = useAgentStore((s) => s.sessions);

  // Generate stable session ids for expanded default
  const activeGroupSessionId = useMemo(() => {
    const active = sessions.get(activeSessionId ?? "");
    if (active?.kind === "group" && active.groupId) return active.groupId;
    return null;
  }, [sessions, activeSessionId]);

  // Group sessions by groupId — based on ALL groups so empty groups still show
  const grouped = useMemo(() => {
    const groupItems = items.filter((item) => {
      const kind = item.kind === "memory" ? item.session.kind : item.info.kind;
      return kind === "group";
    });

    const sessionsByGroup = new Map<string, UnifiedItem[]>();
    for (const item of groupItems) {
      const gid = item.kind === "memory" ? item.session.groupId : item.info.groupId;
      if (!gid) continue;
      let list = sessionsByGroup.get(gid);
      if (!list) {
        list = [];
        sessionsByGroup.set(gid, list);
      }
      list.push(item);
    }

    return groups
      .map((group) => ({
        groupId: group.id,
        groupName: group.name,
        items: sessionsByGroup.get(group.id) ?? [],
        count: sessionsByGroup.get(group.id)?.length ?? 0,
      }))
      .sort((a, b) => a.groupName.localeCompare(b.groupName));
  }, [items, groups]);

  // Expand state: default expand groups with active session
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (activeGroupSessionId) return new Set([activeGroupSessionId]);
    // Also expand first group by default
    if (grouped.length > 0) return new Set([grouped[0].groupId]);
    return new Set();
  });

  const toggleExpand = (groupId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  // ── Quick create ──────────────────────────────────────────
  const [creatingGroupId, setCreatingGroupId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const handleQuickCreate = async (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    setCreating(true);
    try {
      let cwd: string | undefined;
      for (const m of group.members) {
        const p = projects.find((pr) => pr.id === m.projectId);
        if (p) {
          cwd = p.path;
          break;
        }
      }
      if (!cwd) return;

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
    } finally {
      setCreating(false);
      setCreatingGroupId(null);
    }
  };

  if (groups.length === 0) return null;

  return (
    <div className="shrink-0">
      {/* Section header */}
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
        <Layers size={11} strokeWidth={1.5} className="text-muted-foreground/50" />
        <span className="flex-1 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">
          {t("group.sectionTitle", "分组")}
        </span>
      </div>

      {/* Group entries */}
      <ul className="flex flex-col gap-0.5">
        {grouped.map(({ groupId: gid, groupName, items: groupItems }) => {
          const isExpanded = expanded.has(gid);
          const color = groupColor(gid);
          const group = groups.find((g) => g.id === gid);
          const isCreating = creatingGroupId === gid;

          return (
            <li key={gid}>
              {/* Group header */}
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => toggleExpand(gid)}
              >
                <ChevronRight
                  size={10}
                  strokeWidth={1.75}
                  className={`shrink-0 text-muted-foreground/60 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                />
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: color.dot }}
                />
                <span className="flex-1 truncate text-left font-medium text-foreground/80">
                  {groupName}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground/50">
                  {groupItems.length}
                </span>
                {/* Quick create button */}
                <button
                  type="button"
                  className="relative shrink-0 rounded p-0.5 text-muted-foreground/50 hover:text-primary hover:bg-accent cursor-pointer"
                  disabled={creating}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCreatingGroupId(isCreating ? null : gid);
                  }}
                  title={t("group.quickCreate", "新建分组对话")}
                >
                  <Plus size={12} strokeWidth={1.75} />
                </button>
              </button>

              {/* Quick create popover */}
              {isCreating && group && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setCreatingGroupId(null)} />
                  <div className="relative z-50 ml-6 mr-2 mt-1 rounded-md border bg-popover p-1 shadow-md">
                    <button
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-xs hover:bg-accent disabled:opacity-40"
                      onClick={() => handleQuickCreate(gid)}
                      disabled={creating}
                    >
                      <Lock size={12} strokeWidth={1.5} />
                      {t("group.focusReadOnly", "不指定（全只读模式）")}
                    </button>
                    <div className="my-0.5 h-px bg-border" />
                    {group.members.map((m) => {
                      const proj = projects.find((p) => p.id === m.projectId);
                      return (
                        <button
                          key={m.projectId}
                          className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-xs hover:bg-accent disabled:opacity-40"
                          onClick={() => handleQuickCreate(gid)}
                          disabled={creating || !proj}
                        >
                          <SquarePen size={12} strokeWidth={1.5} />
                          <span className="truncate">{proj?.name ?? m.projectId}</span>
                          {m.role && (
                            <span className="ml-auto text-[10px] text-muted-foreground/60">
                              {m.role}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Session list (expanded) */}
              {isExpanded && groupItems.length > 0 && (
                <ul className="ml-4 flex flex-col gap-0.5">
                  {groupItems.map((item) => {
                    const id =
                      item.kind === "memory" ? item.session.sessionId : item.info.sessionId;
                    return (
                      <UnifiedSessionItem
                        key={id}
                        item={item}
                        activeSessionId={activeSessionId}
                        isPinned={pinnedIds.has(id)}
                        restoring={restoring}
                        onActivate={onActivate}
                        onLoad={onLoad}
                      />
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// --- Self-contained wrapper for multi-project mode ---

export const GroupSessionsList = memo(function GroupSessionsList() {
  const activeSessionId = useAgentStore((s) => s.activeSessionId);
  const setActiveSession = useAgentStore((s) => s.setActiveSession);
  const loadSession = useLoadSession();
  const [restoring, setRestoring] = useState<string | null>(null);
  const switchToProjectByPath = useProjectStore((s) => s.switchToProjectByPath);
  const pinnedSessions = useProjectStore((s) => s.pinnedSessions);
  const items = useFilteredSessions({ filter: "unpinned" });

  const pinnedIds = useMemo(() => {
    const set = new Set<string>();
    for (const ids of Object.values(pinnedSessions)) {
      for (const id of ids) set.add(id);
    }
    return set;
  }, [pinnedSessions]);

  const handleActivate = useCallback(
    (sessionId: string, projectPath?: string) => {
      if (projectPath) switchToProjectByPath(projectPath);
      setActiveSession(sessionId);
    },
    [switchToProjectByPath, setActiveSession],
  );

  const handleLoad = useCallback(
    async (sessionId: string, projectPath?: string) => {
      setRestoring(sessionId);
      try {
        if (projectPath) switchToProjectByPath(projectPath);
        await loadSession(sessionId);
      } finally {
        setRestoring((prev) => (prev === sessionId ? null : prev));
      }
    },
    [switchToProjectByPath, loadSession],
  );

  return (
    <GroupSessionsSection
      items={items}
      pinnedIds={pinnedIds}
      activeSessionId={activeSessionId}
      restoring={restoring}
      onActivate={handleActivate}
      onLoad={handleLoad}
    />
  );
});
