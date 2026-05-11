import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@electron-toolkit/utils", () => ({
  is: { dev: true },
}));

import type { ConfigStore } from "../../config/config-store";
import type { ProjectStore } from "../../project/project-store";

import { Pushable } from "../pushable";
import { RequestTracker } from "../request-tracker";
import { SessionManager } from "../session-manager";
import { buildQueryOptions } from "../session/init";

const makeStreamEventMsg = (event: any) => ({
  type: "stream_event" as const,
  event,
  uuid: "stream-uuid",
  session_id: "session-1",
  parent_tool_use_id: null,
});

const makeMessageStartEvent = (id: string) => ({
  type: "message_start" as const,
  message: {
    id,
    role: "assistant" as const,
    content: [],
    model: "claude-3",
    stop_reason: null,
    stop_sequence: null,
    type: "message" as const,
    usage: { input_tokens: 10, output_tokens: 0 },
  },
});

const makeResultMsg = () => ({
  type: "result" as const,
  subtype: "success" as const,
  uuid: "result-uuid",
  session_id: "session-1",
  is_error: false,
  num_turns: 1,
  duration_ms: 10,
  total_cost_usd: 0.001,
  usage: { input_tokens: 10, output_tokens: 5 },
  stop_reason: "end_turn",
  errors: [],
});

function makeGroupServiceMock() {
  const fn = vi.fn<any>;
  return {
    getGroup: fn(() => undefined),
    getGroups: fn(() => []),
    expandMembers: fn(() => []),
    findGroupsContainingProject: fn(() => []),
    getProjectGroupRefs: fn(() => []),
  };
}

describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager(
      { get: vi.fn(() => undefined) } as unknown as ConfigStore,
      {} as ProjectStore,
      new RequestTracker(),
      {
        onTurnStart: vi.fn(),
        onTurnEnd: vi.fn(),
        onSessionClosed: vi.fn(),
      } as unknown as import("../../../core/power-blocker-service").PowerBlockerService,
      makeGroupServiceMock() as any,
    );
  });

  it("closeSession for unknown sessionId does not throw", async () => {
    await expect(manager.closeSession("nonexistent")).resolves.toBeUndefined();
  });

  it("closeAll on empty manager does not throw", async () => {
    await expect(manager.closeAll()).resolves.toBeUndefined();
  });

  it("listSessions returns empty array for nonexistent dir", async () => {
    const sessions = await manager.listSessions("/tmp/nonexistent-" + Date.now());
    expect(sessions).toBeInstanceOf(Array);
  });

  it("enables partial assistant messages in query options", () => {
    const initContext = (manager as any).facadeContext.initContext;
    const queryOptions = buildQueryOptions(initContext, {
      sessionId: "session-1",
      cwd: "/tmp/project",
    });

    expect(queryOptions.includePartialMessages).toBe(true);
  });

  it("send() converts UIMessage to SDKUserMessage and pushes to input", async () => {
    const input = { push: vi.fn() };
    const queryMessages = new Pushable<any>();
    const queryIterator = queryMessages[Symbol.asyncIterator]();
    const query = {
      next: () => queryIterator.next(),
      interrupt: vi.fn(),
      setPermissionMode: vi.fn(),
    };

    (manager as any).sessions.set("session-1", {
      input,
      query,
      cwd: "/tmp/project",
      consumeExited: false,
      uiToSdkMessageIds: new Map(),
      pendingRequests: new Map(),
    });

    await manager.send("session-1", {
      id: "user-msg-1",
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
    } as any);

    expect(input.push).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "user",
        message: { role: "user", content: "Hello" },
        parent_tool_use_id: null,
        session_id: "session-1",
      }),
    );
  });

  it("send() throws for unknown sessionId", async () => {
    await expect(
      manager.send("nonexistent", {
        id: "msg-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      } as any),
    ).rejects.toThrow("Unknown session");
  });

  it("send() restarts consume loop when it has exited", async () => {
    const input = { push: vi.fn() };
    const queryMessages = new Pushable<any>();
    const queryIterator = queryMessages[Symbol.asyncIterator]();
    const query = {
      next: () => queryIterator.next(),
      interrupt: vi.fn(),
      setPermissionMode: vi.fn(),
    };

    (manager as any).sessions.set("session-1", {
      input,
      query,
      cwd: "/tmp/project",
      consumeExited: true,
      uiToSdkMessageIds: new Map(),
      pendingRequests: new Map(),
    });

    // Mock restartConsume to avoid dynamic import of @anthropic-ai/claude-agent-sdk
    const restartSpy = vi.spyOn(manager as any, "restartConsume").mockResolvedValue(undefined);

    await expect(
      manager.send("session-1", {
        id: "msg-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      } as any),
    ).resolves.toBeUndefined();

    expect(restartSpy).toHaveBeenCalledWith("session-1");
    expect(input.push).toHaveBeenCalled();
  });

  it("send() starts requestTracker turn and powerBlocker", async () => {
    const input = { push: vi.fn() };
    const queryMessages = new Pushable<any>();
    const queryIterator = queryMessages[Symbol.asyncIterator]();
    const query = {
      next: () => queryIterator.next(),
      interrupt: vi.fn(),
      setPermissionMode: vi.fn(),
    };

    (manager as any).sessions.set("session-1", {
      input,
      query,
      cwd: "/tmp/project",
      consumeExited: false,
      uiToSdkMessageIds: new Map(),
      pendingRequests: new Map(),
    });

    await manager.send("session-1", {
      id: "user-msg-1",
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
    } as any);

    expect((manager as any).powerBlocker.onTurnStart).toHaveBeenCalledWith("session-1");
  });

  it("consume() publishes chunks through eventPublisher", async () => {
    const input = { push: vi.fn() };
    const queryMessages = new Pushable<any>();
    const queryIterator = queryMessages[Symbol.asyncIterator]();
    const query = {
      next: () => queryIterator.next(),
      interrupt: vi.fn(),
      setPermissionMode: vi.fn(),
    };

    (manager as any).sessions.set("session-1", {
      input,
      query,
      cwd: "/tmp/project",
      consumeExited: false,
      uiToSdkMessageIds: new Map(),
      pendingRequests: new Map(),
    });

    const published: any[] = [];
    const originalPublish = manager.eventPublisher.publish.bind(manager.eventPublisher);
    vi.spyOn(manager.eventPublisher, "publish").mockImplementation((key, value) => {
      published.push(value);
      return originalPublish(key, value);
    });

    const consumePromise = (manager as any).consume("session-1");

    // Push a message_start event
    queryMessages.push(makeStreamEventMsg(makeMessageStartEvent("msg-1")));
    // Allow microtask processing
    await new Promise((r) => setTimeout(r, 50));

    // Push result to end the loop
    queryMessages.push(makeResultMsg());
    // End the query iterator
    queryMessages.end();

    await consumePromise;

    // Should have published chunk events
    const chunkEvents = published.filter((e) => e.kind === "chunk");
    expect(chunkEvents.length).toBeGreaterThan(0);
    expect(chunkEvents[0]).toMatchObject({ kind: "chunk", chunk: { type: "start" } });

    // Should have published context_usage event on result
    const contextUsageEvents = published.filter(
      (e) => e.kind === "event" && e.event.type === "context_usage",
    );
    expect(contextUsageEvents.length).toBe(1);
  });

  it("consume() sets consumeExited when done", async () => {
    const input = { push: vi.fn() };
    const queryMessages = new Pushable<any>();
    const queryIterator = queryMessages[Symbol.asyncIterator]();
    const query = {
      next: () => queryIterator.next(),
      interrupt: vi.fn(),
      setPermissionMode: vi.fn(),
    };

    (manager as any).sessions.set("session-1", {
      input,
      query,
      cwd: "/tmp/project",
      consumeExited: false,
      uiToSdkMessageIds: new Map(),
      pendingRequests: new Map(),
    });

    const consumePromise = (manager as any).consume("session-1");
    queryMessages.end();
    await consumePromise;

    const session = (manager as any).sessions.get("session-1");
    expect(session.consumeExited).toBe(true);
  });

  it("consume() calls powerBlocker.onTurnEnd in finally block", async () => {
    const input = { push: vi.fn() };
    const queryMessages = new Pushable<any>();
    const queryIterator = queryMessages[Symbol.asyncIterator]();
    const query = {
      next: () => queryIterator.next(),
      interrupt: vi.fn(),
      setPermissionMode: vi.fn(),
    };

    (manager as any).sessions.set("session-1", {
      input,
      query,
      cwd: "/tmp/project",
      consumeExited: false,
      uiToSdkMessageIds: new Map(),
      pendingRequests: new Map(),
    });

    const consumePromise = (manager as any).consume("session-1");
    queryMessages.end();
    await consumePromise;

    expect((manager as any).powerBlocker.onTurnEnd).toHaveBeenCalledWith("session-1");
  });
});

describe("SessionManager — group session", () => {
  let manager: SessionManager;
  const groupServiceMock = makeGroupServiceMock();

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SessionManager(
      { get: vi.fn(() => undefined) } as unknown as ConfigStore,
      {} as ProjectStore,
      new RequestTracker(),
      {
        onTurnStart: vi.fn(),
        onTurnEnd: vi.fn(),
        onSessionClosed: vi.fn(),
      } as unknown as import("../../../core/power-blocker-service").PowerBlockerService,
      groupServiceMock as any,
    );
  });

  function setSession(overrides: Record<string, unknown> = {}) {
    (manager as any).sessions.set("s1", {
      cwd: "/code/edu-portal",
      kind: "group",
      groupId: "g-edu",
      focusProjectId: "p-portal",
      groupMembers: [
        {
          projectId: "p-portal",
          role: "consumer",
          path: "/code/edu-portal",
          name: "edu-portal",
          missing: false,
        },
        {
          projectId: "p-design",
          role: "library",
          path: "/code/edu-design",
          name: "edu-design",
          missing: false,
        },
      ],
      input: { push: vi.fn() },
      query: { next: vi.fn(), interrupt: vi.fn(), setPermissionMode: vi.fn() },
      consumeExited: false,
      uiToSdkMessageIds: new Map(),
      pendingRequests: new Map(),
      ...overrides,
    });
  }

  describe("setFocusProject", () => {
    it("switches focus and sets pending hint", () => {
      setSession();
      manager.setFocusProject("s1", "p-design");

      const session = (manager as any).sessions.get("s1");
      expect(session.focusProjectId).toBe("p-design");
      expect(session.pendingHint).toContain("edu-design");
      expect(session.pendingHint).toContain("焦点已切换");
    });

    it("throws for non-group session", () => {
      setSession({ kind: "single" });
      expect(() => manager.setFocusProject("s1", "p-design")).toThrow("not a group session");
    });

    it("throws for unknown session", () => {
      expect(() => manager.setFocusProject("nonexistent", "p-design")).toThrow("Unknown session");
    });

    it("throws for non-member project", () => {
      setSession();
      expect(() => manager.setFocusProject("s1", "p-unknown")).toThrow("not a member");
    });

    it("throws for missing member", () => {
      setSession({
        groupMembers: [
          {
            projectId: "p-portal",
            role: "consumer",
            path: "/code/edu-portal",
            name: "edu-portal",
            missing: false,
          },
          { projectId: "p-design", role: "library", path: null, name: "edu-design", missing: true },
        ],
      });
      expect(() => manager.setFocusProject("s1", "p-design")).toThrow("cannot switch focus");
    });
  });

  describe("onGroupChanged", () => {
    it("refreshes group members snapshot", () => {
      setSession();
      const expanded = [
        {
          projectId: "p-portal",
          role: "consumer" as const,
          path: "/code/edu-portal",
          name: "edu-portal",
          missing: false,
        },
        {
          projectId: "p-design",
          role: "library" as const,
          path: "/code/edu-design",
          name: "edu-design",
          missing: false,
        },
        {
          projectId: "p-new",
          role: "shared" as const,
          path: "/code/edu-new",
          name: "edu-new",
          missing: false,
        },
      ];
      groupServiceMock.getGroup.mockReturnValue({ id: "g-edu", name: "Edu", members: [] });
      groupServiceMock.expandMembers.mockReturnValue(expanded);

      manager.onGroupChanged("g-edu");

      const session = (manager as any).sessions.get("s1");
      expect(session.groupMembers).toBe(expanded);
      expect(session.pendingHint).toContain("分组成员已更新");
    });

    it("clears focus when current focus is removed from group", () => {
      setSession();
      const expanded = [
        {
          projectId: "p-design",
          role: "library" as const,
          path: "/code/edu-design",
          name: "edu-design",
          missing: false,
        },
      ];
      groupServiceMock.getGroup.mockReturnValue({ id: "g-edu", name: "Edu", members: [] });
      groupServiceMock.expandMembers.mockReturnValue(expanded);

      manager.onGroupChanged("g-edu");

      const session = (manager as any).sessions.get("s1");
      expect(session.focusProjectId).toBeUndefined();
    });

    it("clears focus when current focus goes missing", () => {
      setSession();
      const expanded = [
        {
          projectId: "p-portal",
          role: "consumer" as const,
          path: null,
          name: "edu-portal",
          missing: true,
        },
        {
          projectId: "p-design",
          role: "library" as const,
          path: "/code/edu-design",
          name: "edu-design",
          missing: false,
        },
      ];
      groupServiceMock.getGroup.mockReturnValue({ id: "g-edu", name: "Edu", members: [] });
      groupServiceMock.expandMembers.mockReturnValue(expanded);

      manager.onGroupChanged("g-edu");

      const session = (manager as any).sessions.get("s1");
      expect(session.focusProjectId).toBeUndefined();
    });

    it("does nothing for non-existent group", () => {
      setSession();
      groupServiceMock.getGroup.mockReturnValue(undefined);

      expect(() => manager.onGroupChanged("g-nonexistent")).not.toThrow();
      const session = (manager as any).sessions.get("s1");
      expect(session.focusProjectId).toBe("p-portal"); // unchanged
    });

    it("only affects sessions for the target group", () => {
      setSession();
      // Add a second session for a different group
      (manager as any).sessions.set("s2", {
        kind: "group",
        groupId: "g-other",
        focusProjectId: "p-other",
        groupMembers: [
          {
            projectId: "p-other",
            role: "consumer",
            path: "/code/other",
            name: "other",
            missing: false,
          },
        ],
        cwd: "/code/other",
      });

      groupServiceMock.getGroup.mockReturnValue({ id: "g-edu", name: "Edu", members: [] });
      groupServiceMock.expandMembers.mockReturnValue([]);

      manager.onGroupChanged("g-edu");

      const s2 = (manager as any).sessions.get("s2");
      expect(s2.groupMembers).toHaveLength(1); // unchanged
      expect(s2.focusProjectId).toBe("p-other"); // unchanged
    });
  });
});
