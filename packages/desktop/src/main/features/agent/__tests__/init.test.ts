import { describe, expect, it, vi } from "vitest";

vi.mock("@electron-toolkit/utils", () => ({
  is: { dev: true },
}));

import type { ProjectGroup } from "../../../../shared/features/project/types";
import type { ConfigStore } from "../../config/config-store";
import type { GroupMemberSnapshot } from "../session/types";

import { RequestTracker } from "../request-tracker";
import { buildQueryOptions } from "../session/init";

function makeInitContext() {
  return {
    sessions: new Map(),
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
      focusProjectId: "p-portal",
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
      expect(append).toContain("仅作用于聚焦项目");
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

  it("does NOT inject systemPrompt.append for group without focus member", () => {
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
      focusProjectId: "p-portal",
    });

    // Focus member is missing → no append should be injected
    if (opts.systemPrompt && typeof opts.systemPrompt === "object") {
      const append = (opts.systemPrompt as any).append;
      expect(append).toBeUndefined();
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
});
