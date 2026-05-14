import { describe, expect, it } from "vitest";

import type { ProjectGroup } from "../../../../shared/features/project/types";
import type { GroupMemberSnapshot } from "../../agent/session/types";

import { renderGroupContext } from "../render-group-context";

function makeGroup(name: string, members: { projectId: string; role?: string }[]): ProjectGroup {
  return {
    id: "g-" + name.toLowerCase(),
    name,
    members: members as ProjectGroup["members"],
    createdAt: "2026-01-01T00:00:00.000Z",
    lastUpdatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function member(projectId: string, overrides?: Partial<GroupMemberSnapshot>): GroupMemberSnapshot {
  return {
    projectId,
    role: overrides?.role,
    path: overrides?.path ?? `/Volumes/code/${projectId}`,
    name: overrides?.name ?? projectId,
    missing: overrides?.missing ?? false,
  };
}

describe("renderGroupContext", () => {
  it("renders group name in output", () => {
    const group = makeGroup("Edu", [{ projectId: "p-portal" }]);
    const members = [member("p-portal")];
    const focus = members[0]!;
    const result = renderGroupContext(group, members, focus);

    expect(result).toContain("Edu");
  });

  it("renders member with custom role text and path", () => {
    const group = makeGroup("Edu", [{ projectId: "p-portal", role: "前端门户" }]);
    const members = [
      member("p-portal", {
        name: "edu-portal",
        path: "/Volumes/code/edu-portal",
        role: "前端门户",
      }),
    ];
    const focus = members[0]!;
    const result = renderGroupContext(group, members, focus);

    expect(result).toContain("edu-portal");
    expect(result).toContain("(前端门户)");
    expect(result).toContain("/Volumes/code/edu-portal");
    // 聚焦项目概念已移除，统一全只读模式
    expect(result).not.toContain("聚焦项目");
  });

  it("omits role suffix when role is undefined", () => {
    const group = makeGroup("Edu", [{ projectId: "p-portal" }]);
    const members = [member("p-portal", { name: "edu-portal" })];
    const focus = members[0]!;
    const result = renderGroupContext(group, members, focus);

    // 没有任何带括号的 role 标注（仅有 markdown 粗体名）
    expect(result).toContain("**edu-portal**\n");
    expect(result).not.toMatch(/\*\*edu-portal\*\* \(/);
  });

  it("omits role suffix when role is empty string", () => {
    const group = makeGroup("Edu", [{ projectId: "p-portal", role: "" }]);
    const members = [member("p-portal", { name: "edu-portal", role: "" })];
    const focus = members[0]!;
    const result = renderGroupContext(group, members, focus);

    expect(result).toContain("**edu-portal**\n");
    expect(result).not.toMatch(/\*\*edu-portal\*\* \(/);
  });

  it("renders other non-focus members", () => {
    const group = makeGroup("Edu", [
      { projectId: "p-portal", role: "前端" },
      { projectId: "p-design", role: "设计稿来源" },
    ]);
    const members = [
      member("p-portal", { name: "edu-portal", role: "前端" }),
      member("p-design", { name: "edu-design", role: "设计稿来源" }),
    ];
    const focus = members[0]!;
    const result = renderGroupContext(group, members, focus);

    expect(result).toContain("edu-design");
    expect(result).toContain("(设计稿来源)");
  });

  it("renders single member in member list when only one member exists", () => {
    const group = makeGroup("Solo", [{ projectId: "p-only" }]);
    const members = [member("p-only")];
    const focus = members[0]!;
    const result = renderGroupContext(group, members, focus);

    // 统一全只读模式：不再区分聚焦/非聚焦，所有成员在组成员列表中展示
    expect(result).toContain("组成员");
    expect(result).toContain("p-only");
    expect(result).not.toContain("无其他成员");
  });

  it("does NOT include missing members", () => {
    const group = makeGroup("Edu", [
      { projectId: "p-portal", role: "前端" },
      { projectId: "p-ghost" },
    ]);
    const members = [
      member("p-portal", { name: "edu-portal", role: "前端" }),
      member("p-ghost", { name: "ghost-project", missing: true, path: null }),
    ];
    const focus = members[0]!;
    const result = renderGroupContext(group, members, focus);

    expect(result).not.toContain("ghost-project");
  });

  it("renders collaboration rules", () => {
    const group = makeGroup("Edu", [{ projectId: "p-portal" }]);
    const members = [member("p-portal")];
    const focus = members[0]!;
    const result = renderGroupContext(group, members, focus);

    expect(result).toContain("协作规则");
    // 聚焦项目概念已移除，统一全只读模式
    expect(result).not.toContain("仅作用于聚焦项目");
    expect(result).toContain("不允许 Edit/Write/MultiEdit/NotebookEdit");
    expect(result).toContain("Read/Grep/Glob");
  });

  it("renders group context header", () => {
    const group = makeGroup("Neovate", [{ projectId: "p-neovate" }]);
    const members = [member("p-neovate", { name: "neovate-desktop" })];
    const focus = members[0]!;
    const result = renderGroupContext(group, members, focus);

    expect(result).toContain("## 项目分组上下文");
    expect(result).toContain("组对话");
    expect(result).toContain("Neovate");
  });

  describe("read-only mode (focus === null)", () => {
    it("renders 全只读模式 header and skips focus section", () => {
      const group = makeGroup("Edu", [
        { projectId: "p-portal", role: "前端" },
        { projectId: "p-design", role: "设计" },
      ]);
      const members = [
        member("p-portal", { name: "edu-portal", role: "前端" }),
        member("p-design", { name: "edu-design", role: "设计" }),
      ];
      const result = renderGroupContext(group, members, null);

      expect(result).toContain("组对话（全只读模式）");
      expect(result).toContain("Edu");
      expect(result).not.toContain("当前聚焦项目");
      expect(result).not.toContain("聚焦项目");
      expect(result).toContain("组成员");
      expect(result).toContain("edu-portal");
      expect(result).toContain("edu-design");
      expect(result).toContain("(前端)");
      expect(result).toContain("(设计)");
    });

    it("includes read-only collaboration rules", () => {
      const group = makeGroup("Edu", [{ projectId: "p-portal" }]);
      const members = [member("p-portal")];
      const result = renderGroupContext(group, members, null);

      expect(result).toContain("协作规则");
      expect(result).toContain("全只读模式");
      expect(result).toContain("不允许 Edit/Write/MultiEdit/NotebookEdit");
      expect(result).toContain("Read/Grep/Glob/LSP");
    });

    it("excludes missing members in read-only listing", () => {
      const group = makeGroup("Edu", [
        { projectId: "p-portal", role: "前端" },
        { projectId: "p-ghost" },
      ]);
      const members = [
        member("p-portal", { name: "edu-portal", role: "前端" }),
        member("p-ghost", { name: "ghost-project", missing: true, path: null }),
      ];
      const result = renderGroupContext(group, members, null);

      expect(result).not.toContain("ghost-project");
      expect(result).toContain("edu-portal");
    });

    it("renders 无可用成员 when all members are missing", () => {
      const group = makeGroup("Edu", [{ projectId: "p-ghost" }]);
      const members = [member("p-ghost", { name: "ghost-project", missing: true, path: null })];
      const result = renderGroupContext(group, members, null);

      expect(result).toContain("无可用成员");
    });
  });
});
