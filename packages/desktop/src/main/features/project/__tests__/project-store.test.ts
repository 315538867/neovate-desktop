import { beforeEach, describe, expect, it, vi } from "vitest";

const { sharedStores } = vi.hoisted(() => ({
  // shared state across `new Store(...)` calls of the same name, so
  // tests can set up pre-existing data (e.g. legacy enum roles) before
  // instantiating ProjectStore to exercise its migration logic.
  sharedStores: new Map<string, Record<string, unknown>>(),
}));

vi.mock("electron-store", () => ({
  default: vi.fn(function (this: any, opts: any) {
    const defaults = (opts as any)?.defaults ?? {};
    const key = `${opts?.cwd ?? ""}::${opts?.name ?? "default"}`;
    if (!sharedStores.has(key)) {
      sharedStores.set(key, { ...defaults });
    } else {
      // merge defaults for any new keys
      const existing = sharedStores.get(key)!;
      for (const k of Object.keys(defaults)) {
        if (!(k in existing)) existing[k] = defaults[k];
      }
    }
    const data = sharedStores.get(key)!;
    this.get = function (k: string) {
      return data[k];
    };
    this.set = function (keyOrObj: string | Record<string, unknown>, value?: unknown) {
      if (typeof keyOrObj === "string") {
        data[keyOrObj] = value;
      } else {
        Object.assign(data, keyOrObj);
      }
    };
    this.delete = function (k: string) {
      delete data[k];
    };
    Object.defineProperty(this, "store", {
      get() {
        return data;
      },
    });
    this.clear = function () {
      for (const k of Object.keys(data)) delete data[k];
    };
  }),
}));

import { PLAYGROUND_PROJECT_ID } from "../../../../shared/features/project/constants";
import { ProjectStore } from "../project-store";

describe("ProjectStore groups", () => {
  let store: ProjectStore;

  beforeEach(() => {
    sharedStores.clear();
    store = new ProjectStore();
    store.ensurePlayground();
  });

  describe("addGroup / getGroups / getGroup", () => {
    it("adds a group and retrieves it", () => {
      const group = {
        id: "g1",
        name: "Edu",
        members: [
          { projectId: "p1", role: "前端" },
          { projectId: "p2", role: "组件库" },
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
        members: [{ projectId: "p1", role: "前端" }],
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      });
      store.updateGroup("g1", {
        name: "New",
        members: [
          { projectId: "p1", role: "前端" },
          { projectId: "p2", role: "组件库" },
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
        members: [{ projectId: "p1", role: "前端" }],
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
        members: [{ projectId: "p1", role: "前端" }],
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      });
    });

    it("adds a new member", () => {
      store.addGroupMember("g1", { projectId: "p2", role: "组件库" });
      expect(store.getGroup("g1")!.members).toHaveLength(2);
    });

    it("does not duplicate existing member", () => {
      store.addGroupMember("g1", { projectId: "p1", role: "组件库" });
      expect(store.getGroup("g1")!.members).toHaveLength(1);
    });

    it("updates member role", () => {
      store.updateGroupMemberRole("g1", "p1", "共享模块");
      expect(store.getGroup("g1")!.members[0]!.role).toBe("共享模块");
    });

    it("clears member role when undefined", () => {
      store.updateGroupMemberRole("g1", "p1", undefined);
      expect(store.getGroup("g1")!.members[0]!.role).toBeUndefined();
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
          { projectId: "p1", role: "前端" },
          { projectId: "p2", role: "组件库" },
          { projectId: "p3" },
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
        members: [{ projectId: "p-shared", role: "共享" }],
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      });
      store.addGroup({
        id: "g2",
        name: "Neovate",
        members: [{ projectId: "p-shared", role: "工具" }],
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

describe("ProjectStore role migration", () => {
  beforeEach(() => {
    sharedStores.clear();
  });

  function findStoreByName(name: string): Record<string, unknown> | undefined {
    for (const [key, value] of sharedStores.entries()) {
      if (key.endsWith(`::${name}`)) return value;
    }
    return undefined;
  }

  it("resets legacy enum role values to undefined on first load", () => {
    // Seed pre-existing data simulating the old shape (enum role fields).
    const seeded = new ProjectStore();
    void seeded;
    const data = findStoreByName("projects");
    expect(data).toBeTruthy();
    const legacy = [
      {
        id: "g1",
        name: "Edu",
        members: [
          { projectId: "p1", role: "consumer" },
          { projectId: "p2", role: "library" },
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
        lastUpdatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    data!.groups = legacy;
    delete data!.groupsRoleMigrationVersion;

    // Re-instantiate; migration should run because version is missing.
    const store = new ProjectStore();
    const groups = store.getGroups();
    expect(groups[0]!.members.every((m) => m.role === undefined)).toBe(true);
    expect(data!.groupsRoleMigrationVersion).toBe("v1");
  });

  it("does NOT clobber roles after migration is already done", () => {
    const seeded = new ProjectStore();
    seeded.addGroup({
      id: "g1",
      name: "Edu",
      members: [{ projectId: "p1", role: "我亲手填的" }],
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUpdatedAt: "2026-01-01T00:00:00.000Z",
    });
    // seeded constructor already set version to "v1"
    const data = findStoreByName("projects");
    expect(data!.groupsRoleMigrationVersion).toBe("v1");

    // Re-instantiate; migration is a no-op because version === "v1".
    const store = new ProjectStore();
    expect(store.getGroup("g1")!.members[0]!.role).toBe("我亲手填的");
  });

  it("sets the migration version flag even when groups list is empty", () => {
    new ProjectStore();
    const data = findStoreByName("projects");
    expect(data!.groupsRoleMigrationVersion).toBe("v1");
  });
});
