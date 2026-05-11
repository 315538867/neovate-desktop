import { ORPCError } from "@orpc/server";
import { BrowserWindow, dialog } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import type { ProjectGroup, ProjectGroupMember } from "../../../shared/features/project/types";

import { PLAYGROUND_PROJECT_ID } from "../../../shared/features/project/constants";
import { projectContract } from "../../../shared/features/project/contract";
import { defineRouter } from "../../core/router-factory";

const { os, log } = defineRouter({
  contract: { project: projectContract },
  debugNs: "neovate:project",
});

/** Cached existsSync to avoid repeated filesystem checks on every list() call. */
const pathCache = new Map<string, { exists: boolean; ts: number }>();
const PATH_CACHE_TTL = 5_000;

function pathExists(p: string): boolean {
  const cached = pathCache.get(p);
  if (cached && Date.now() - cached.ts < PATH_CACHE_TTL) return cached.exists;
  const exists = existsSync(p);
  pathCache.set(p, { exists, ts: Date.now() });
  return exists;
}

export const projectRouter = os.project.router({
  list: os.project.list.handler(({ context }) => {
    return context.projectStore.getAll().map((p) => ({
      ...p,
      pathMissing: !pathExists(p.path),
    }));
  }),

  create: os.project.create.handler(({ input, context }) => {
    log("create project", { path: input.path, name: input.name });
    const existing = context.projectStore.findByPath(input.path);
    if (existing) {
      log("project already exists, updating lastAccessedAt", { id: existing.id });
      context.projectStore.update(existing.id, { lastAccessedAt: new Date().toISOString() });
      return { ...existing, lastAccessedAt: new Date().toISOString() };
    }

    const project = {
      id: randomUUID(),
      name: input.name ?? path.basename(input.path),
      path: input.path,
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
    };
    log("adding new project", { id: project.id, name: project.name });
    context.projectStore.add(project);
    return project;
  }),

  open: os.project.open.handler(({ input, context }) => {
    log("open project", { path: input.path });
    if (!existsSync(input.path)) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Directory does not exist: ${input.path}`,
      });
    }
    const existing = context.projectStore.findByPath(input.path);
    if (existing) {
      log("project already exists, activating", { id: existing.id });
      context.projectStore.update(existing.id, { lastAccessedAt: new Date().toISOString() });
      context.projectStore.setActive(existing.id);
      return { ...existing, lastAccessedAt: new Date().toISOString() };
    }

    const project = {
      id: randomUUID(),
      name: path.basename(input.path),
      path: input.path,
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
    };
    log("adding and activating new project", { id: project.id, name: project.name });
    context.projectStore.add(project);
    context.projectStore.setActive(project.id);
    return project;
  }),

  remove: os.project.remove.handler(({ input, context }) => {
    if (input.id === PLAYGROUND_PROJECT_ID) {
      throw new ORPCError("BAD_REQUEST", { message: "Cannot remove the playground project" });
    }
    log("remove project", { id: input.id });
    // Soft hint: check if project is referenced by any groups (does NOT block deletion).
    const blockedBy = context.projectStore.findGroupsByProject(input.id);
    context.projectStore.remove(input.id);
    if (blockedBy.length > 0) {
      return { blockedBy };
    }
    return;
  }),

  setActive: os.project.setActive.handler(({ input, context }) => {
    log("set active project", { id: input.id });
    if (input.id !== null) {
      const project = context.projectStore.get(input.id);
      if (project && !existsSync(project.path)) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Project directory does not exist: ${project.path}`,
        });
      }
    }
    context.projectStore.setActive(input.id);
  }),

  getActive: os.project.getActive.handler(({ context }) => {
    const project = context.projectStore.getActive();
    if (project && !existsSync(project.path)) {
      log("active project path missing, clearing: %s", project.path);
      context.projectStore.setActive(null);
      // Fall through to playground fallback below
    } else if (project) {
      return project;
    }

    // Fallback: if no active project and no user projects exist, activate playground
    const all = context.projectStore.getAll();
    const hasUserProjects = all.some((p) => p.id !== PLAYGROUND_PROJECT_ID);
    if (!hasUserProjects) {
      const playground = context.projectStore.getPlayground();
      if (playground) {
        log("no user projects, falling back to playground");
        context.projectStore.setActive(PLAYGROUND_PROJECT_ID);
        return playground;
      }
    }
    return null;
  }),

  pickDirectory: os.project.pickDirectory.handler(async () => {
    log("opening directory picker");
    const win = BrowserWindow.getFocusedWindow();
    const options: Electron.OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      log("directory picker canceled");
      return null;
    }
    log("directory selected", { path: result.filePaths[0] });
    return { path: result.filePaths[0] };
  }),

  getArchivedSessions: os.project.getArchivedSessions.handler(({ context }) => {
    return context.projectStore.getArchivedSessions();
  }),

  archiveSession: os.project.archiveSession.handler(({ input, context }) => {
    log("archive session", { projectPath: input.projectPath, sessionId: input.sessionId });
    context.projectStore.archiveSession(input.projectPath, input.sessionId);
  }),

  getPinnedSessions: os.project.getPinnedSessions.handler(({ context }) => {
    return context.projectStore.getPinnedSessions();
  }),

  togglePinSession: os.project.togglePinSession.handler(({ input, context }) => {
    log("toggle pin session", { projectPath: input.projectPath, sessionId: input.sessionId });
    context.projectStore.togglePinSession(input.projectPath, input.sessionId);
  }),

  getClosedAccordions: os.project.getClosedAccordions.handler(({ context }) => {
    return context.projectStore.getClosedProjectAccordions();
  }),

  setClosedAccordions: os.project.setClosedAccordions.handler(({ input, context }) => {
    context.projectStore.setClosedProjectAccordions(input.ids);
  }),

  reorderProjects: os.project.reorderProjects.handler(({ input, context }) => {
    log("reorder projects", { projectIds: input.projectIds });
    context.projectStore.reorder(input.projectIds);
  }),

  // ── 分组 ──────────────────────────────────────────────
  groups: os.project.groups.router({
    list: os.project.groups.list.handler(({ context }) => {
      return context.projectStore.getGroups();
    }),

    create: os.project.groups.create.handler(({ input, context }) => {
      log("create group", { name: input.name, members: input.members.length });
      // playground project cannot join any group
      for (const m of input.members) {
        if (m.projectId === PLAYGROUND_PROJECT_ID) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Playground project cannot join a group",
          });
        }
        if (!context.projectStore.get(m.projectId)) {
          throw new ORPCError("BAD_REQUEST", {
            message: `Project not found: ${m.projectId}`,
          });
        }
      }

      const now = new Date().toISOString();
      const group: ProjectGroup = {
        id: randomUUID(),
        name: input.name,
        members: input.members as ProjectGroupMember[],
        createdAt: now,
        lastUpdatedAt: now,
      };
      context.projectStore.addGroup(group);
      return group;
    }),

    update: os.project.groups.update.handler(({ input, context }) => {
      log("update group", { id: input.id });
      const existing = context.projectStore.getGroup(input.id);
      if (!existing) {
        throw new ORPCError("BAD_REQUEST", { message: `Group not found: ${input.id}` });
      }
      const updates: Partial<Pick<ProjectGroup, "name" | "members">> = {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.members !== undefined) {
        // Validate all member projects exist
        for (const m of input.members) {
          if (m.projectId === PLAYGROUND_PROJECT_ID) {
            throw new ORPCError("BAD_REQUEST", {
              message: "Playground project cannot join a group",
            });
          }
          if (!context.projectStore.get(m.projectId)) {
            throw new ORPCError("BAD_REQUEST", {
              message: `Project not found: ${m.projectId}`,
            });
          }
        }
        updates.members = input.members as ProjectGroupMember[];
      }
      context.projectStore.updateGroup(input.id, updates);
      context.sessionManager.onGroupChanged(input.id);
      return context.projectStore.getGroup(input.id)!;
    }),

    remove: os.project.groups.remove.handler(({ input, context }) => {
      log("remove group", { id: input.id });
      const existing = context.projectStore.getGroup(input.id);
      if (!existing) {
        throw new ORPCError("BAD_REQUEST", { message: `Group not found: ${input.id}` });
      }

      // Block deletion if active group conversations exist
      const blockingSessions = context.sessionManager.listActiveByGroup(input.id);
      if (blockingSessions.length > 0) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Cannot delete group with active conversations (${blockingSessions.length} active)`,
          data: { blockingSessions },
        });
      }

      context.projectStore.removeGroup(input.id);
      return { success: true };
    }),

    reorder: os.project.groups.reorder.handler(({ input, context }) => {
      log("reorder groups", { groupIds: input.groupIds });
      context.projectStore.reorderGroups(input.groupIds);
    }),

    addMember: os.project.groups.addMember.handler(({ input, context }) => {
      const group = context.projectStore.getGroup(input.groupId);
      if (!group) {
        throw new ORPCError("BAD_REQUEST", { message: `Group not found: ${input.groupId}` });
      }
      if (input.member.projectId === PLAYGROUND_PROJECT_ID) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Playground project cannot join a group",
        });
      }
      if (!context.projectStore.get(input.member.projectId)) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Project not found: ${input.member.projectId}`,
        });
      }
      context.projectStore.addGroupMember(input.groupId, input.member as ProjectGroupMember);
      context.sessionManager.onGroupChanged(input.groupId);
    }),

    updateMember: os.project.groups.updateMember.handler(({ input, context }) => {
      const group = context.projectStore.getGroup(input.groupId);
      if (!group) {
        throw new ORPCError("BAD_REQUEST", { message: `Group not found: ${input.groupId}` });
      }
      if (!group.members.some((m) => m.projectId === input.projectId)) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Member not found in group: ${input.projectId}`,
        });
      }
      context.projectStore.updateGroupMemberRole(input.groupId, input.projectId, input.role);
      context.sessionManager.onGroupChanged(input.groupId);
    }),

    removeMember: os.project.groups.removeMember.handler(({ input, context }) => {
      const group = context.projectStore.getGroup(input.groupId);
      if (!group) {
        throw new ORPCError("BAD_REQUEST", { message: `Group not found: ${input.groupId}` });
      }
      context.projectStore.removeGroupMember(input.groupId, input.projectId);
      context.sessionManager.onGroupChanged(input.groupId);
    }),

    reorderMembers: os.project.groups.reorderMembers.handler(({ input, context }) => {
      const group = context.projectStore.getGroup(input.groupId);
      if (!group) {
        throw new ORPCError("BAD_REQUEST", { message: `Group not found: ${input.groupId}` });
      }
      context.projectStore.reorderGroupMembers(input.groupId, input.memberProjectIds);
    }),
  }),
});
