import type { ProjectGroup } from "../../../shared/features/project/types";
import type { GroupMemberSnapshot } from "../agent/session/types";

/**
 * 渲染组对话的系统提示上下文（注入到 systemPrompt.append）。
 * 分组会话统一为全只读模式：所有成员可读，写操作需 JIT elevation。
 */

function roleSuffix(role: string | undefined): string {
  return role ? ` (${role})` : "";
}

export function renderGroupContext(
  group: ProjectGroup,
  members: GroupMemberSnapshot[],
  _focus: GroupMemberSnapshot | null,
): string {
  const visibleMembers = members.filter((m) => !m.missing);
  const memberLines =
    visibleMembers.length > 0
      ? visibleMembers
          .map((m) => `- **${m.name}**${roleSuffix(m.role)}\n  路径：${m.path}`)
          .join("\n")
      : "（无可用成员）";

  return [
    "## 项目分组上下文",
    "",
    `当前会话属于 **组对话（全只读模式）**，所属分组 **${group.name}**。`,
    "",
    "### 组成员",
    memberLines,
    "",
    "### 协作规则",
    "- 当前为全只读模式：不允许 Edit/Write/MultiEdit/NotebookEdit。",
    "- 所有成员的 Read/Grep/Glob/LSP 完全开放，请主动探索它们的代码以理解关系。",
    "- 当需要在某个成员上执行写操作时，你将被提示向用户征询写权限。用户批准后，该成员变为可写（本会话内有效）。",
    "- Bash 中的写操作请同样遵守只读边界。",
    "- **重要**：当用户模糊提及「项目」或要求查看/搜索/探索代码而未指明具体成员时，必须同时探查所有组成员的代码，而非仅查看某一个。",
  ].join("\n");
}
