import { z } from "zod";

/** 组成员的角色 */
export const projectRoleSchema = z.enum([
  "library",
  "consumer",
  "shared",
  "service",
  "tool",
  "other",
]);

export const projectGroupMemberSchema = z.object({
  projectId: z.string(),
  role: projectRoleSchema,
});

export const projectGroupSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  members: z.array(projectGroupMemberSchema),
  createdAt: z.string(),
  lastUpdatedAt: z.string(),
});

/** Input for creating a new group (id + timestamps assigned by server). */
export const createGroupInputSchema = z.object({
  name: z.string().min(1),
  members: z.array(projectGroupMemberSchema),
});

/** Input for updating a group. */
export const updateGroupInputSchema = z.object({
  name: z.string().min(1).optional(),
  members: z.array(projectGroupMemberSchema).optional(),
});
