import { oc, type } from "@orpc/contract";
import { z } from "zod";

import type { Project, ProjectGroup, ProjectInfo } from "./types";

/** 角色：自由文本，可选；空白被规整为 undefined */
const roleSchema = z
  .string()
  .trim()
  .max(60)
  .optional()
  .transform((v) => (v ? v : undefined));

const memberSchema = z.object({
  projectId: z.string(),
  role: roleSchema,
});

export const projectContract = {
  list: oc.output(type<ProjectInfo[]>()),

  create: oc
    .input(z.object({ path: z.string(), name: z.string().optional() }))
    .output(type<Project>()),

  open: oc.input(z.object({ path: z.string() })).output(type<Project>()),

  remove: oc
    .input(z.object({ id: z.string() }))
    .output(type<{ blockedBy?: { groupId: string; groupName: string }[] } | void>()),

  setActive: oc.input(z.object({ id: z.nullable(z.string()) })).output(type<void>()),

  getActive: oc.output(type<Project | null>()),

  pickDirectory: oc.output(type<{ path: string } | null>()),

  getArchivedSessions: oc.output(type<Record<string, string[]>>()),

  archiveSession: oc
    .input(z.object({ projectPath: z.string(), sessionId: z.string() }))
    .output(type<void>()),

  getPinnedSessions: oc.output(type<Record<string, string[]>>()),

  togglePinSession: oc
    .input(z.object({ projectPath: z.string(), sessionId: z.string() }))
    .output(type<void>()),

  getClosedAccordions: oc.output(type<string[]>()),

  setClosedAccordions: oc.input(z.object({ ids: z.array(z.string()) })).output(type<void>()),

  reorderProjects: oc.input(z.object({ projectIds: z.array(z.string()) })).output(type<void>()),

  // ── 分组 ──────────────────────────────────────────────
  groups: {
    list: oc.output(type<ProjectGroup[]>()),

    create: oc
      .input(
        z.object({
          name: z.string().min(1),
          members: z.array(memberSchema),
        }),
      )
      .output(type<ProjectGroup>()),

    update: oc
      .input(
        z.object({
          id: z.string(),
          name: z.string().min(1).optional(),
          members: z.array(memberSchema).optional(),
        }),
      )
      .output(type<ProjectGroup>()),

    remove: oc.input(z.object({ id: z.string() })).output(
      type<{
        success: boolean;
        blockingSessions?: { sessionId: string; title?: string }[];
      }>(),
    ),

    reorder: oc.input(z.object({ groupIds: z.array(z.string()) })).output(type<void>()),

    addMember: oc
      .input(
        z.object({
          groupId: z.string(),
          member: memberSchema,
        }),
      )
      .output(type<void>()),

    updateMember: oc
      .input(
        z.object({
          groupId: z.string(),
          projectId: z.string(),
          role: roleSchema,
        }),
      )
      .output(type<void>()),

    removeMember: oc
      .input(z.object({ groupId: z.string(), projectId: z.string() }))
      .output(type<void>()),

    reorderMembers: oc
      .input(z.object({ groupId: z.string(), memberProjectIds: z.array(z.string()) }))
      .output(type<void>()),
  },
};
