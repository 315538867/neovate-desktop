import fs from "node:fs";
import path from "node:path";

import type { SessionEntry } from "./types";

const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const READ_TOOLS = new Set(["Read", "Grep", "Glob"]);

/**
 * 工具输入中路径字段的命名映射。
 * - Edit/Write/MultiEdit: file_path
 * - NotebookEdit: notebook_path
 * - Read: file_path
 * - Grep/Glob: path
 */
const PATH_FIELD: Record<string, string> = {
  Edit: "file_path",
  Write: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
  Read: "file_path",
  Grep: "path",
  Glob: "path",
};

function extractPath(toolName: string, input: Record<string, unknown>): string | undefined {
  const field = PATH_FIELD[toolName];
  if (!field) return undefined;
  const value = input[field];
  return typeof value === "string" ? value : undefined;
}

function isWithin(parent: string | null, child: string): boolean {
  if (!parent) return false;
  try {
    const p = fs.realpathSync.native(parent);
    const c = fs.realpathSync.native(child);
    const rel = path.relative(p, c);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

export type GuardResult = { allow: true } | { allow: false; reason: string };

export function checkToolPath(
  toolName: string,
  input: Record<string, unknown>,
  session: SessionEntry,
): GuardResult {
  const filePath = extractPath(toolName, input);
  if (!filePath) return { allow: true };

  // single: 在 cwd 之内放行
  if (session.kind === "single") {
    if (isWithin(session.cwd, filePath)) return { allow: true };
    return { allow: false, reason: `路径 ${filePath} 不在项目 ${session.cwd} 内` };
  }

  // group
  const focus = session.groupMembers!.find((m) => m.projectId === session.focusProjectId);
  if (!focus || focus.missing) {
    return { allow: false, reason: "当前聚焦项目已不存在或路径丢失，请先在 UI 切换聚焦项目" };
  }

  const isWrite = WRITE_TOOLS.has(toolName);
  const isRead = READ_TOOLS.has(toolName);

  if (isWrite) {
    if (isWithin(focus.path, filePath)) return { allow: true };
    const refMember = session.groupMembers!.find((m) => !m.missing && isWithin(m.path, filePath));
    if (refMember) {
      return {
        allow: false,
        reason: `${filePath} 属于组成员 ${refMember.name}（${refMember.role}），仅当前聚焦项目 ${focus.name} 可写。如需修改，请告知用户切换聚焦项目。`,
      };
    }
    return { allow: false, reason: `${filePath} 不在分组任何成员内` };
  }

  if (isRead) {
    if (session.groupMembers!.some((m) => !m.missing && isWithin(m.path, filePath)))
      return { allow: true };
    return { allow: false, reason: `${filePath} 不在分组任何成员内` };
  }

  // 其他工具（Bash 等）：不在此校验
  return { allow: true };
}
