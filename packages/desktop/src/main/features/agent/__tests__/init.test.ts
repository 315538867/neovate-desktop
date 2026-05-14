import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@electron-toolkit/utils", () => ({
  is: { dev: true },
}));

import type { ProjectGroup } from "../../../../shared/features/project/types";
import type { ConfigStore } from "../../config/config-store";
import type { GroupMemberSnapshot, SessionEntry } from "../session/types";

import { RequestTracker } from "../request-tracker";
import { buildQueryOptions } from "../session/init";

function tmpDir() {
  return join(tmpdir(), "neovate-init-" + Math.random().toString(36).slice(2));
}

function makeInitContext() {
  return {
    sessions: new Map() as Map<string, SessionEntry>,
    configStore: {
      get: vi.fn((key: string) => {
        if (key === "permissionMode") return "default";
        return undefined;
      }),
    } as unknown as ConfigStore,
    requestTracker: new RequestTracker(),
    eventPublisher: { publish: vi.fn() } as any,
    powerBlocker: { onTurnStart: vi.fn(), onTurnEnd: vi.fn(), onSessionClosed: vi.fn() } as any,
    getAgentContributions: () => [],
    closeSession: vi.fn(),
    startConsume: vi.fn(),
    log: vi.fn(),
    rtkLog: vi.fn(),
  };
}

function makeGroup(): ProjectGroup {
  return {
    id: "g-edu",
    name: "Edu",
    members: [
      { projectId: "p-portal", role: "consumer" },
      { projectId: "p-design", role: "library" },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    lastUpdatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeMembers(): GroupMemberSnapshot[] {
  return [
    {
      projectId: "p-portal",
      role: "consumer",
      path: "/tmp/portal",
      name: "edu-portal",
      missing: false,
    },
    {
      projectId: "p-design",
      role: "library",
      path: "/tmp/design",
      name: "edu-design",
      missing: false,
    },
  ];
}

function makeGroupSession(members: GroupMemberSnapshot[], cwd: string): SessionEntry {
  return {
    input: { push: () => {} } as any,
    query: {
      next: async () => ({ done: true, value: undefined }),
      interrupt: () => {},
      setPermissionMode: () => {},
    } as any,
    cwd,
    consumeExited: false,
    uiToSdkMessageIds: new Map(),
    pendingRequests: new Map(),
    createdAt: Date.now(),
    kind: "group",
    groupId: "g-edu",
    groupMembers: members,
  };
}

describe("buildQueryOptions", () => {
  it("sets includePartialMessages to true", () => {
    const ctx = makeInitContext();
    const opts = buildQueryOptions(ctx, {
      sessionId: "s1",
      cwd: "/tmp/project",
    });
    expect(opts.includePartialMessages).toBe(true);
  });

  it("sets permissionMode from config", () => {
    const ctx = makeInitContext();
    (ctx.configStore.get as any).mockReturnValue("acceptEdits");
    const opts = buildQueryOptions(ctx, {
      sessionId: "s1",
      cwd: "/tmp/project",
    });
    expect(opts.permissionMode).toBe("acceptEdits");
  });

  it("injects systemPrompt.append for group sessions", () => {
    const ctx = makeInitContext();
    const group = makeGroup();
    const members = makeMembers();
    const opts = buildQueryOptions(ctx, {
      sessionId: "s1",
      cwd: "/tmp/portal",
      kind: "group",
      group,
      groupMembers: members,
    });

    expect(opts.systemPrompt).toBeDefined();
    expect(typeof opts.systemPrompt).toBe("object");
    if (
      opts.systemPrompt &&
      typeof opts.systemPrompt === "object" &&
      "append" in opts.systemPrompt
    ) {
      const append = (opts.systemPrompt as any).append as string;
      expect(append).toContain("项目分组上下文");
      expect(append).toContain("Edu");
      expect(append).toContain("edu-portal");
      expect(append).toContain("consumer");
      expect(append).toContain("edu-design");
      expect(append).toContain("library");
    }
  });

  it("does NOT inject systemPrompt.append for single sessions", () => {
    const ctx = makeInitContext();
    const opts = buildQueryOptions(ctx, {
      sessionId: "s1",
      cwd: "/tmp/project",
    });

    // For single sessions, systemPrompt should be preset without append
    if (opts.systemPrompt && typeof opts.systemPrompt === "object") {
      const append = (opts.systemPrompt as any).append;
      expect(append).toBeUndefined();
    }
  });

  it("injects read-only systemPrompt.append for group with missing members", () => {
    const ctx = makeInitContext();
    const group = makeGroup();
    const members: GroupMemberSnapshot[] = [
      { projectId: "p-portal", role: "consumer", path: null, name: "edu-portal", missing: true },
      {
        projectId: "p-design",
        role: "library",
        path: "/tmp/design",
        name: "edu-design",
        missing: false,
      },
    ];
    const opts = buildQueryOptions(ctx, {
      sessionId: "s1",
      cwd: "/tmp/portal",
      kind: "group",
      group,
      groupMembers: members,
    });

    // Even with missing members, read-only append is injected
    expect(opts.systemPrompt).toBeDefined();
    if (
      opts.systemPrompt &&
      typeof opts.systemPrompt === "object" &&
      "append" in opts.systemPrompt
    ) {
      const append = (opts.systemPrompt as any).append as string;
      expect(append).toContain("全只读模式");
      expect(append).toContain("edu-design");
    }
  });

  it("does NOT inject systemPrompt.append for group without group/groupMembers", () => {
    const ctx = makeInitContext();
    const opts = buildQueryOptions(ctx, {
      sessionId: "s1",
      cwd: "/tmp/project",
      kind: "group",
    });

    if (opts.systemPrompt && typeof opts.systemPrompt === "object") {
      const append = (opts.systemPrompt as any).append;
      expect(append).toBeUndefined();
    }
  });

  it("injects 全只读模式 systemPrompt.append for group sessions", () => {
    const ctx = makeInitContext();
    const group = makeGroup();
    const members = makeMembers();
    const opts = buildQueryOptions(ctx, {
      sessionId: "s1",
      cwd: "/tmp/portal",
      kind: "group",
      group,
      groupMembers: members,
    });

    expect(opts.systemPrompt).toBeDefined();
    if (
      opts.systemPrompt &&
      typeof opts.systemPrompt === "object" &&
      "append" in opts.systemPrompt
    ) {
      const append = (opts.systemPrompt as any).append as string;
      expect(append).toContain("全只读模式");
      expect(append).toContain("Edu");
      expect(append).toContain("edu-portal");
      expect(append).toContain("edu-design");
      expect(append).toContain("不允许 Edit/Write/MultiEdit/NotebookEdit");
      expect(append).not.toContain("当前聚焦项目");
    }
  });

  describe("canUseTool with elevation", () => {
    let dirA: string;
    let dirB: string;
    let ctx: ReturnType<typeof makeInitContext>;

    beforeEach(() => {
      dirA = tmpDir();
      dirB = tmpDir();
      mkdirSync(dirA, { recursive: true });
      mkdirSync(dirB, { recursive: true });
      ctx = makeInitContext();
    });

    afterEach(() => {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    });

    function touch(dir: string, relative: string) {
      const p = join(dir, relative);
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, "");
      return p;
    }

    it("publishes request with elevation when writing to non-focus member", async () => {
      const members: GroupMemberSnapshot[] = [
        { projectId: "p-a", role: "consumer", path: dirA, name: "ProjectA", missing: false },
        { projectId: "p-b", role: "library", path: dirB, name: "ProjectB", missing: false },
      ];
      const session = makeGroupSession(members, dirA);
      ctx.sessions.set("s1", session);

      const opts = buildQueryOptions(ctx, {
        sessionId: "s1",
        cwd: dirA,
        kind: "group",
        group: makeGroup(),
        groupMembers: members,
      });

      const file = touch(dirB, "lib/util.ts");
      const signal = new AbortController().signal;
      const result = opts.canUseTool!("Write", { file_path: file }, { signal, toolUseID: "t1" });

      // Should not be an immediate deny — it publishes a request event
      expect(result).not.toHaveProperty("behavior", "deny");

      expect(ctx.eventPublisher.publish).toHaveBeenCalledWith(
        "s1",
        expect.objectContaining({
          kind: "request",
          request: expect.objectContaining({
            type: "permission_request",
            toolName: "Write",
            elevation: { projectId: "p-b", projectName: "ProjectB" },
          }),
        }),
      );
    });

    it("directly denies write outside any group member without publishing", async () => {
      const members: GroupMemberSnapshot[] = [
        { projectId: "p-a", role: "consumer", path: dirA, name: "ProjectA", missing: false },
      ];
      const session = makeGroupSession(members, dirA);
      ctx.sessions.set("s1", session);

      const opts = buildQueryOptions(ctx, {
        sessionId: "s1",
        cwd: dirA,
        kind: "group",
        group: makeGroup(),
        groupMembers: members,
      });

      const signal = new AbortController().signal;
      const result = await opts.canUseTool!(
        "Edit",
        { file_path: "/etc/hosts" },
        { signal, toolUseID: "t2" },
      );

      expect(result).toHaveProperty("behavior", "deny");
      expect(result).toHaveProperty("message");
      if ("message" in result) {
        expect(result.message).toContain("不在分组任何成员内");
      }

      // No request event should be published for hard-deny
      const requestCalls = (ctx.eventPublisher.publish as any).mock.calls.filter(
        ([, event]: any) => event?.kind === "request",
      );
      expect(requestCalls).toHaveLength(0);
    });
  });
});
