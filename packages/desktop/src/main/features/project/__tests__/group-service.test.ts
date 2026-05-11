import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpHandle } = vi.hoisted(() => ({
  tmpHandle: { dir: "" },
}));

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

import type { ProjectGroup } from "../../../../shared/features/project/types";

import { GroupService } from "../group-service";
import { ProjectStore } from "../project-store";

describe("GroupService", () => {
  let projectStore: ProjectStore;
  let service: GroupService;

  beforeEach(() => {
    tmpHandle.dir = mkdtempSync(join(tmpdir(), "neovate-test-group-service-"));
    projectStore = new ProjectStore();
    service = new GroupService(projectStore);
  });

  afterEach(() => {
    rmSync(tmpHandle.dir, { recursive: true, force: true });
  });

  function addProject(id: string, name: string, dir: string) {
    mkdirSync(dir, { recursive: true });
    projectStore.add({
      id,
      name,
      path: dir,
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
    });
  }

  function addGroup(id: string, name: string, members: { projectId: string; role: string }[]) {
    projectStore.addGroup({
      id,
      name,
      members: members as ProjectGroup["members"],
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    });
  }

  describe("getGroup / getGroups", () => {
    it("returns group by id", () => {
      addGroup("g1", "Edu", []);
      expect(service.getGroup("g1")!.name).toBe("Edu");
    });

    it("returns undefined for missing group", () => {
      expect(service.getGroup("nonexistent")).toBeUndefined();
    });

    it("returns all groups", () => {
      addGroup("g1", "A", []);
      addGroup("g2", "B", []);
      expect(service.getGroups()).toHaveLength(2);
    });
  });

  describe("expandMembers", () => {
    it("expands valid members with paths", () => {
      const d1 = join(tmpHandle.dir, "p1");
      const d2 = join(tmpHandle.dir, "p2");
      addProject("p1", "portal", d1);
      addProject("p2", "design", d2);
      addGroup("g1", "Edu", [
        { projectId: "p1", role: "consumer" },
        { projectId: "p2", role: "library" },
      ]);

      const expanded = service.expandMembers(service.getGroup("g1")!);
      expect(expanded).toHaveLength(2);
      expect(expanded[0]!).toMatchObject({
        projectId: "p1",
        role: "consumer",
        name: "portal",
        path: d1,
        missing: false,
      });
      expect(expanded[1]!).toMatchObject({
        projectId: "p2",
        role: "library",
        name: "design",
        path: d2,
        missing: false,
      });
    });

    it("marks members as missing when project is deleted from store", () => {
      const d1 = join(tmpHandle.dir, "p1");
      addProject("p1", "portal", d1);
      addGroup("g1", "Edu", [
        { projectId: "p1", role: "consumer" },
        { projectId: "p-ghost", role: "library" },
      ]);

      const expanded = service.expandMembers(service.getGroup("g1")!);
      expect(expanded).toHaveLength(2);
      expect(expanded[0]!).toMatchObject({ projectId: "p1", missing: false });
      expect(expanded[1]!).toMatchObject({
        projectId: "p-ghost",
        role: "library",
        path: null,
        name: "p-ghost",
        missing: true,
      });
    });

    it("marks members as missing when project path no longer exists on disk", () => {
      const d1 = join(tmpHandle.dir, "p1-nonexistent");
      // Add project with path that does not exist on disk
      projectStore.add({
        id: "p1",
        name: "portal",
        path: d1,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      });
      addGroup("g1", "Edu", [{ projectId: "p1", role: "consumer" }]);

      const expanded = service.expandMembers(service.getGroup("g1")!);
      expect(expanded[0]!).toMatchObject({
        projectId: "p1",
        name: "portal",
        path: null,
        missing: true,
      });
    });
  });

  describe("findGroupsContainingProject", () => {
    it("finds all groups a project belongs to", () => {
      addGroup("g1", "Edu", [{ projectId: "p-shared", role: "shared" }]);
      addGroup("g2", "Neovate", [{ projectId: "p-shared", role: "tool" }]);
      addGroup("g3", "Other", [{ projectId: "p-other", role: "consumer" }]);

      const groups = service.findGroupsContainingProject("p-shared");
      expect(groups).toHaveLength(2);
      expect(groups.map((g) => g.name)).toEqual(["Edu", "Neovate"]);
    });

    it("returns empty when project not in any group", () => {
      expect(service.findGroupsContainingProject("nonexistent")).toEqual([]);
    });
  });

  describe("getProjectGroupRefs", () => {
    it("returns group id/name pairs for a project", () => {
      addGroup("g1", "Edu", [{ projectId: "p-shared", role: "shared" }]);
      const refs = service.getProjectGroupRefs("p-shared");
      expect(refs).toEqual([{ groupId: "g1", groupName: "Edu" }]);
    });
  });
});
