import { z } from "zod";

/** 角色：自由文本，可选；空白被规整为 undefined */
const roleSchema = z
  .string()
  .trim()
  .max(60)
  .optional()
  .transform((v) => (v ? v : undefined));

export const projectGroupMemberSchema = z.object({
  projectId: z.string(),
  role: roleSchema,
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
