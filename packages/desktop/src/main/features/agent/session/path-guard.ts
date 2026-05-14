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

export type GuardResult =
  | { allow: true; checked: boolean }
  | { allow: false; reason: string; elevation?: { projectId: string; projectName: string } };

export function checkToolPath(
  toolName: string,
  input: Record<string, unknown>,
  session: SessionEntry,
): GuardResult {
  const filePath = extractPath(toolName, input);
  // 无路径字段的工具（Bash 等）：不在此校验
  if (!filePath) return { allow: true, checked: false };

  // single: 在 cwd 之内放行
  if (session.kind === "single") {
    if (isWithin(session.cwd, filePath)) return { allow: true, checked: true };
    return { allow: false, reason: `路径 ${filePath} 不在项目 ${session.cwd} 内` };
  }

  // group: 全只读模式，所有写操作需 elevation，读操作全部放行
  const isWrite = WRITE_TOOLS.has(toolName);
  const isRead = READ_TOOLS.has(toolName);

  if (isWrite) {
    // 写到已提升项目：放行
    const elevated = session.elevatedProjectIds;
    if (elevated && elevated.size > 0) {
      const inElevated = session.groupMembers!.find(
        (m) => !m.missing && elevated.has(m.projectId) && isWithin(m.path, filePath),
      );
      if (inElevated) return { allow: true, checked: true };
    }

    // 写到任一成员：deny + 携带 elevation 元数据（可提升）
    const refMember = session.groupMembers!.find((m) => !m.missing && isWithin(m.path, filePath));
    if (refMember) {
      return {
        allow: false,
        reason: `当前为全只读模式；${filePath} 属于组成员 ${refMember.name}，可向用户征询是否允许在本会话内放行该项目的写权限。`,
        elevation: { projectId: refMember.projectId, projectName: refMember.name },
      };
    }

    return { allow: false, reason: `${filePath} 不在分组任何成员内` };
  }

  if (isRead) {
    if (session.groupMembers!.some((m) => !m.missing && isWithin(m.path, filePath)))
      return { allow: true, checked: true };
    return { allow: false, reason: `${filePath} 不在分组任何成员内` };
  }

  // 其他工具（Bash 等）：不在此校验
  return { allow: true, checked: false };
}
