import { describe, expect, it } from "vitest";

import type { ProjectGroup } from "../../../../shared/features/project/types";
import type { GroupMemberSnapshot } from "../../agent/session/types";

import { renderGroupContext } from "../render-group-context";

function makeGroup(name: string, members: { projectId: string; role: string }[]): ProjectGroup {
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
    role: overrides?.role ?? "consumer",
    path: overrides?.path ?? `/Volumes/code/${projectId}`,
    name: overrides?.name ?? projectId,
    missing: overrides?.missing ?? false,
  };
}

describe("renderGroupContext", () => {
  it("renders group name in output", () => {
    const group = makeGroup("Edu", [{ projectId: "p-portal", role: "consumer" }]);
    const members = [member("p-portal")];
    const focus = members[0]!;
    const result = renderGroupContext(group, members, focus);

    expect(result).toContain("Edu");
  });

  it("renders focus member with role and path", () => {
    const group = makeGroup("Edu", [{ projectId: "p-portal", role: "consumer" }]);
    const members = [member("p-portal", { name: "edu-portal", path: "/Volumes/code/edu-portal" })];
    const focus = members[0]!;
    const result = renderGroupContext(group, members, focus);

    expect(result).toContain("edu-portal");
    expect(result).toContain("consumer");
    expect(result).toContain("/Volumes/code/edu-portal");
    expect(result).toContain("聚焦项目");
  });

  it("renders other non-focus members", () => {
    const group = makeGroup("Edu", [
      { projectId: "p-portal", role: "consumer" },
      { projectId: "p-design", role: "library" },
    ]);
    const members = [
      member("p-portal", { name: "edu-portal", role: "consumer" }),
      member("p-design", { name: "edu-design", role: "library" }),
    ];
    const focus = members[0]!;
    const result = renderGroupContext(group, members, focus);

    expect(result).toContain("edu-design");
    expect(result).toContain("library");
  });

  it('renders "无其他成员" when focus is the only member', () => {
    const group = makeGroup("Solo", [{ projectId: "p-only", role: "other" }]);
    const members = [member("p-only")];
    const focus = members[0]!;
    const result = renderGroupContext(group, members, focus);

    expect(result).toContain("无其他成员");
  });

  it("does NOT include missing members", () => {
    const group = makeGroup("Edu", [
      { projectId: "p-portal", role: "consumer" },
      { projectId: "p-ghost", role: "library" },
    ]);
    const members = [
      member("p-portal", { name: "edu-portal" }),
      member("p-ghost", { name: "ghost-project", missing: true, path: null }),
    ];
    const focus = members[0]!;
    const result = renderGroupContext(group, members, focus);

    expect(result).not.toContain("ghost-project");
  });

  it("renders collaboration rules", () => {
    const group = makeGroup("Edu", [{ projectId: "p-portal", role: "consumer" }]);
    const members = [member("p-portal")];
    const focus = members[0]!;
    const result = renderGroupContext(group, members, focus);

    expect(result).toContain("协作规则");
    expect(result).toContain("仅作用于聚焦项目");
    expect(result).toContain("Edit/Write/MultiEdit/NotebookEdit");
    expect(result).toContain("Read/Grep/Glob");
  });

  it("renders group context header", () => {
    const group = makeGroup("Neovate", [{ projectId: "p-neovate", role: "consumer" }]);
    const members = [member("p-neovate", { name: "neovate-desktop" })];
    const focus = members[0]!;
    const result = renderGroupContext(group, members, focus);

    expect(result).toContain("## 项目分组上下文");
    expect(result).toContain("组对话");
    expect(result).toContain("Neovate");
  });
});
