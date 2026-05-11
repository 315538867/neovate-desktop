import type { ProjectGroup } from "../../../shared/features/project/types";
import type { GroupMemberSnapshot } from "../agent/session/types";

/**
 * 渲染组对话的静态上下文（注入到 systemPrompt.append）。
 * 仅包含存在（!missing）的成员。
 */
export function renderGroupContext(
  group: ProjectGroup,
  members: GroupMemberSnapshot[],
  focus: GroupMemberSnapshot,
): string {
  const focusLines = [`- **${focus.name}** (${focus.role})`, `  路径：${focus.path}`].join("\n");

  const otherMembers = members.filter((m) => m.projectId !== focus.projectId && !m.missing);
  const otherLines =
    otherMembers.length > 0
      ? otherMembers.map((m) => `- **${m.name}** (${m.role})\n  路径：${m.path}`).join("\n")
      : "（无其他成员）";

  return [
    "## 项目分组上下文",
    "",
    `当前会话属于 **组对话**，所属分组 **${group.name}**。`,
    "",
    "### 当前聚焦项目（可读可写）",
    focusLines,
    "",
    "### 同组其他成员（仅可读，禁止 Edit/Write/MultiEdit/NotebookEdit）",
    otherLines,
    "",
    "### 协作规则",
    "- 写操作（Edit/Write/MultiEdit/NotebookEdit）默认仅作用于聚焦项目。",
    "- 其他成员对 Read/Grep/Glob/LSP 完全开放，请主动探索它们的代码以理解关系。",
    "- 如需修改其他成员，请先告知用户切换聚焦项目（用户在 UI 顶部 chip 切换）。",
    "- Bash 中的写操作请遵守同样的边界。",
  ].join("\n");
}
