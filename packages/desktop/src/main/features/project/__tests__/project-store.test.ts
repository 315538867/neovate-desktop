import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron-store", () => ({
  default: vi.fn(function (this: any, opts: any) {
    const defaults = (opts as any)?.defaults ?? {};
    let data: Record<string, unknown> = { ...defaults };
    this.get = function (key: string) {
      return data[key];
    };
    this.set = function (keyOrObj: string | Record<string, unknown>, value?: unknown) {
      if (typeof keyOrObj === "string") {
        data[keyOrObj] = value;
      } else {
        Object.assign(data, keyOrObj);
      }
    };
    this.delete = function (key: string) {
      delete data[key];
    };
    Object.defineProperty(this, "store", {
      get() {
        return data;
      },
    });
    this.clear = function () {
      data = {};
    };
  }),
}));

import { PLAYGROUND_PROJECT_ID } from "../../../../shared/features/project/constants";
import { ProjectStore } from "../project-store";

describe("ProjectStore groups", () => {
  let store: ProjectStore;

  beforeEach(() => {
    store = new ProjectStore();
    store.ensurePlayground();
  });

  describe("addGroup / getGroups / getGroup", () => {
    it("adds a group and retrieves it", () => {
      const group = {
        id: "g1",
        name: "Edu",
        members: [
          { projectId: "p1", role: "consumer" as const },
          { projectId: "p2", role: "library" as const },
        ],
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      };
      store.addGroup(group);
      expect(store.getGroups()).toHaveLength(1);
      expect(store.getGroup("g1")).toEqual(group);
    });

    it("starts with empty groups (migration default)", () => {
      expect(store.getGroups()).toEqual([]);
    });
  });

  describe("updateGroup", () => {
    it("updates name and members", () => {
      store.addGroup({
        id: "g1",
        name: "Old",
        members: [{ projectId: "p1", role: "consumer" as const }],
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      });
      store.updateGroup("g1", {
        name: "New",
        members: [
          { projectId: "p1", role: "consumer" as const },
          { projectId: "p2", role: "library" as const },
        ],
      });
      const g = store.getGroup("g1")!;
      expect(g.name).toBe("New");
      expect(g.members).toHaveLength(2);
    });

    it("partial update keeps unchanged fields", () => {
      store.addGroup({
        id: "g1",
        name: "Edu",
        members: [{ projectId: "p1", role: "consumer" as const }],
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      });
      store.updateGroup("g1", { name: "Edu V2" });
      const g = store.getGroup("g1")!;
      expect(g.name).toBe("Edu V2");
      expect(g.members).toHaveLength(1);
    });
  });

  describe("removeGroup", () => {
    it("removes a group by id", () => {
      store.addGroup({
        id: "g1",
        name: "Edu",
        members: [],
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      });
      store.removeGroup("g1");
      expect(store.getGroups()).toHaveLength(0);
    });
  });

  describe("reorderGroups", () => {
    it("reorders groups by id list", () => {
      store.addGroup({ id: "g1", name: "A", members: [], createdAt: "", lastUpdatedAt: "" });
      store.addGroup({ id: "g2", name: "B", members: [], createdAt: "", lastUpdatedAt: "" });
      store.addGroup({ id: "g3", name: "C", members: [], createdAt: "", lastUpdatedAt: "" });
      store.reorderGroups(["g3", "g1", "g2"]);
      expect(store.getGroups().map((g) => g.id)).toEqual(["g3", "g1", "g2"]);
    });
  });

  describe("addGroupMember / updateGroupMemberRole / removeGroupMember", () => {
    beforeEach(() => {
      store.addGroup({
        id: "g1",
        name: "Edu",
        members: [{ projectId: "p1", role: "consumer" as const }],
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      });
    });

    it("adds a new member", () => {
      store.addGroupMember("g1", { projectId: "p2", role: "library" as const });
      expect(store.getGroup("g1")!.members).toHaveLength(2);
    });

    it("does not duplicate existing member", () => {
      store.addGroupMember("g1", { projectId: "p1", role: "library" as const });
      expect(store.getGroup("g1")!.members).toHaveLength(1);
    });

    it("updates member role", () => {
      store.updateGroupMemberRole("g1", "p1", "shared" as const);
      expect(store.getGroup("g1")!.members[0]!.role).toBe("shared");
    });

    it("removes a member", () => {
      store.removeGroupMember("g1", "p1");
      expect(store.getGroup("g1")!.members).toHaveLength(0);
    });
  });

  describe("reorderGroupMembers", () => {
    it("reorders members within a group", () => {
      store.addGroup({
        id: "g1",
        name: "Edu",
        members: [
          { projectId: "p1", role: "consumer" as const },
          { projectId: "p2", role: "library" as const },
          { projectId: "p3", role: "shared" as const },
        ],
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      });
      store.reorderGroupMembers("g1", ["p3", "p1", "p2"]);
      expect(store.getGroup("g1")!.members.map((m) => m.projectId)).toEqual(["p3", "p1", "p2"]);
    });
  });

  describe("findGroupsByProject", () => {
    it("finds groups containing a project", () => {
      store.addGroup({
        id: "g1",
        name: "Edu",
        members: [{ projectId: "p-shared", role: "shared" as const }],
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      });
      store.addGroup({
        id: "g2",
        name: "Neovate",
        members: [{ projectId: "p-shared", role: "tool" as const }],
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      });
      const refs = store.findGroupsByProject("p-shared");
      expect(refs).toHaveLength(2);
      expect(refs.map((r) => r.groupName)).toEqual(["Edu", "Neovate"]);
    });

    it("returns empty when project not in any group", () => {
      expect(store.findGroupsByProject("nonexistent")).toEqual([]);
    });
  });

  describe("playground exclusion", () => {
    it("playground id constant is 'playground'", () => {
      expect(PLAYGROUND_PROJECT_ID).toBe("playground");
    });

    it("ensurePlayground creates a playground project", () => {
      const pg = store.get(PLAYGROUND_PROJECT_ID);
      expect(pg).toBeDefined();
      expect(pg!.name).toBe("Playground");
    });
  });
});
