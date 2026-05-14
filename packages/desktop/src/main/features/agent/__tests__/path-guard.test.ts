import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SessionEntry } from "../session/types";

import { checkToolPath } from "../session/path-guard";

function tmpDir() {
  return join(tmpdir(), "neovate-path-guard-" + Math.random().toString(36).slice(2));
}

function touch(dir: string, relative: string) {
  const p = join(dir, relative);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, "");
  return p;
}

function makeSingleSession(cwd: string): SessionEntry {
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
    kind: "single",
  };
}

function makeGroupSession(
  members: {
    projectId: string;
    path: string | null;
    name: string;
    role: string;
    missing: boolean;
  }[],
): SessionEntry {
  return {
    input: { push: () => {} } as any,
    query: {
      next: async () => ({ done: true, value: undefined }),
      interrupt: () => {},
      setPermissionMode: () => {},
    } as any,
    cwd: members.find((m) => m.path)?.path ?? "/tmp/fallback",
    consumeExited: false,
    uiToSdkMessageIds: new Map(),
    pendingRequests: new Map(),
    createdAt: Date.now(),
    kind: "group",
    groupId: "g1",
    groupMembers: members.map((m) => ({
      projectId: m.projectId,
      role: m.role as any,
      path: m.path,
      name: m.name,
      missing: m.missing,
    })),
  };
}

describe("checkToolPath", () => {
  describe("single mode", () => {
    let cwd: string;
    let session: SessionEntry;

    beforeEach(() => {
      cwd = tmpDir();
      mkdirSync(cwd, { recursive: true });
      session = makeSingleSession(cwd);
    });

    afterEach(() => {
      rmSync(cwd, { recursive: true, force: true });
    });

    it("allows Edit within cwd", () => {
      const file = touch(cwd, "src/foo.ts");
      const result = checkToolPath("Edit", { file_path: file }, session);
      expect(result.allow).toBe(true);
    });

    it("denies Write outside cwd", () => {
      const result = checkToolPath("Write", { file_path: "/etc/passwd" }, session);
      expect(result.allow).toBe(false);
      if (!result.allow) {
        expect(result.reason).toContain("不在项目");
      }
    });

    it("allows MultiEdit within cwd", () => {
      const file = touch(cwd, "src/bar.ts");
      const result = checkToolPath("MultiEdit", { file_path: file }, session);
      expect(result.allow).toBe(true);
    });

    it("allows NotebookEdit within cwd", () => {
      const file = touch(cwd, "notebooks/analysis.ipynb");
      const result = checkToolPath("NotebookEdit", { notebook_path: file }, session);
      expect(result.allow).toBe(true);
    });

    it("allows Read within cwd", () => {
      const file = touch(cwd, "readme.md");
      const result = checkToolPath("Read", { file_path: file }, session);
      expect(result.allow).toBe(true);
    });

    it("allows Grep within cwd", () => {
      // cwd directory itself exists
      const result = checkToolPath("Grep", { path: cwd }, session);
      expect(result.allow).toBe(true);
    });

    it("allows Glob within cwd", () => {
      const result = checkToolPath("Glob", { path: cwd }, session);
      expect(result.allow).toBe(true);
    });

    it("allows Bash (no path extraction)", () => {
      const result = checkToolPath("Bash", { command: "rm -rf /" }, session);
      expect(result.allow).toBe(true);
    });
  });

  describe("group mode", () => {
    let dirA: string;
    let dirB: string;
    let session: SessionEntry;

    beforeEach(() => {
      dirA = tmpDir();
      dirB = tmpDir();
      mkdirSync(dirA, { recursive: true });
      mkdirSync(dirB, { recursive: true });
      session = makeGroupSession([
        { projectId: "p-a", path: dirA, name: "ProjectA", role: "consumer", missing: false },
        { projectId: "p-b", path: dirB, name: "ProjectB", role: "library", missing: false },
      ]);
    });

    afterEach(() => {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    });

    it("denies Edit on any member without elevation", () => {
      const file = touch(dirA, "src/index.ts");
      const result = checkToolPath("Edit", { file_path: file }, session);
      expect(result.allow).toBe(false);
      if (!result.allow) {
        expect(result.reason).toContain("全只读模式");
        expect(result.elevation).toEqual({ projectId: "p-a", projectName: "ProjectA" });
      }
    });

    it("denies Write on member with elevation metadata", () => {
      const file = touch(dirB, "lib/util.ts");
      const result = checkToolPath("Write", { file_path: file }, session);
      expect(result.allow).toBe(false);
      if (!result.allow) {
        expect(result.reason).toContain("ProjectB");
        expect(result.elevation).toEqual({ projectId: "p-b", projectName: "ProjectB" });
      }
    });

    it("allows Read on any member", () => {
      const file = touch(dirB, "lib/util.ts");
      const result = checkToolPath("Read", { file_path: file }, session);
      expect(result.allow).toBe(true);
    });

    it("allows Grep on any member", () => {
      // dirB itself exists
      const result = checkToolPath("Grep", { path: dirB }, session);
      expect(result.allow).toBe(true);
    });

    it("allows Glob on any member", () => {
      const result = checkToolPath("Glob", { path: dirB }, session);
      expect(result.allow).toBe(true);
    });

    it("denies MultiEdit on member without elevation", () => {
      const file = touch(dirB, "lib/util.ts");
      const result = checkToolPath("MultiEdit", { file_path: file }, session);
      expect(result.allow).toBe(false);
    });

    it("denies NotebookEdit on member without elevation", () => {
      const file = touch(dirB, "notebooks/analysis.ipynb");
      const result = checkToolPath("NotebookEdit", { notebook_path: file }, session);
      expect(result.allow).toBe(false);
    });

    it("denies write on path outside any member", () => {
      const result = checkToolPath("Edit", { file_path: "/etc/hosts" }, session);
      expect(result.allow).toBe(false);
      if (!result.allow) {
        expect(result.reason).toContain("不在分组任何成员内");
      }
    });

    it("denies read on path outside any member", () => {
      const result = checkToolPath("Read", { file_path: "/etc/hosts" }, session);
      expect(result.allow).toBe(false);
      if (!result.allow) {
        expect(result.reason).toContain("不在分组任何成员内");
      }
    });

    // ── Elevation ──

    it("allows Write on elevated member", () => {
      session.elevatedProjectIds = new Set(["p-b"]);
      const file = touch(dirB, "lib/util.ts");
      const result = checkToolPath("Write", { file_path: file }, session);
      expect(result.allow).toBe(true);
    });

    it("still denies Write on non-elevated member", () => {
      const dirC = tmpDir();
      mkdirSync(dirC, { recursive: true });
      session.groupMembers!.push({
        projectId: "p-c",
        path: dirC,
        name: "ProjectC",
        role: "library",
        missing: false,
      });
      session.elevatedProjectIds = new Set(["p-b"]);
      const file = touch(dirC, "src/app.ts");
      const result = checkToolPath("Edit", { file_path: file }, session);
      expect(result.allow).toBe(false);
      if (!result.allow) {
        expect(result.elevation).toEqual({ projectId: "p-c", projectName: "ProjectC" });
      }
      rmSync(dirC, { recursive: true, force: true });
    });

    it("allows Read on elevated member (elevation does not affect reads)", () => {
      session.elevatedProjectIds = new Set(["p-b"]);
      const file = touch(dirB, "lib/util.ts");
      // Read was already allowed for any member; elevation doesn't change that
      expect(checkToolPath("Read", { file_path: file }, session).allow).toBe(true);
    });
  });

  describe("missing members", () => {
    it("denies writes with elevation metadata when some members missing", () => {
      const dirA = tmpDir();
      mkdirSync(dirA, { recursive: true });
      const session = makeGroupSession([
        { projectId: "p-a", path: null, name: "ProjectA", role: "consumer", missing: true },
        { projectId: "p-b", path: dirA, name: "ProjectB", role: "library", missing: false },
      ]);

      const file = touch(dirA, "foo.ts");
      const result = checkToolPath("Write", { file_path: file }, session);
      expect(result.allow).toBe(false);
      if (!result.allow) {
        expect(result.reason).toContain("全只读模式");
        expect(result.elevation).toEqual({ projectId: "p-b", projectName: "ProjectB" });
      }

      rmSync(dirA, { recursive: true, force: true });
    });

    it("allows reads on existing member even when some members missing", () => {
      const dirB = tmpDir();
      mkdirSync(dirB, { recursive: true });
      const session = makeGroupSession([
        { projectId: "p-a", path: null, name: "ProjectA", role: "consumer", missing: true },
        { projectId: "p-b", path: dirB, name: "ProjectB", role: "library", missing: false },
      ]);

      const file = touch(dirB, "readme.md");
      const result = checkToolPath("Read", { file_path: file }, session);
      expect(result.allow).toBe(true);

      rmSync(dirB, { recursive: true, force: true });
    });
  });

  describe("read-only mode (group, no elevation)", () => {
    let dirA: string;
    let dirB: string;
    let session: SessionEntry;

    beforeEach(() => {
      dirA = tmpDir();
      dirB = tmpDir();
      mkdirSync(dirA, { recursive: true });
      mkdirSync(dirB, { recursive: true });
      session = makeGroupSession([
        { projectId: "p-a", path: dirA, name: "ProjectA", role: "consumer", missing: false },
        { projectId: "p-b", path: dirB, name: "ProjectB", role: "library", missing: false },
      ]);
    });

    afterEach(() => {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    });

    it("denies Edit on any member with 全只读模式 reason and elevation", () => {
      const file = touch(dirA, "src/index.ts");
      const result = checkToolPath("Edit", { file_path: file }, session);
      expect(result.allow).toBe(false);
      if (!result.allow) {
        expect(result.reason).toContain("全只读模式");
        expect(result.elevation).toEqual({ projectId: "p-a", projectName: "ProjectA" });
      }
    });

    it("denies Write on any member with 全只读模式 reason and elevation", () => {
      const file = touch(dirB, "lib/util.ts");
      const result = checkToolPath("Write", { file_path: file }, session);
      expect(result.allow).toBe(false);
      if (!result.allow) {
        expect(result.reason).toContain("全只读模式");
        expect(result.elevation).toEqual({ projectId: "p-b", projectName: "ProjectB" });
      }
    });

    it("denies MultiEdit on any member with 全只读模式 reason", () => {
      const file = touch(dirA, "src/foo.ts");
      const result = checkToolPath("MultiEdit", { file_path: file }, session);
      expect(result.allow).toBe(false);
      if (!result.allow) {
        expect(result.reason).toContain("全只读模式");
        expect(result.elevation).toBeDefined();
      }
    });

    it("denies NotebookEdit on any member with 全只读模式 reason", () => {
      const file = touch(dirA, "notebooks/analysis.ipynb");
      const result = checkToolPath("NotebookEdit", { notebook_path: file }, session);
      expect(result.allow).toBe(false);
      if (!result.allow) {
        expect(result.reason).toContain("全只读模式");
        expect(result.elevation).toBeDefined();
      }
    });

    it("allows Read on any non-missing member", () => {
      const fileA = touch(dirA, "readme.md");
      const fileB = touch(dirB, "lib/util.ts");
      expect(checkToolPath("Read", { file_path: fileA }, session).allow).toBe(true);
      expect(checkToolPath("Read", { file_path: fileB }, session).allow).toBe(true);
    });

    it("allows Grep/Glob on any non-missing member", () => {
      expect(checkToolPath("Grep", { path: dirA }, session).allow).toBe(true);
      expect(checkToolPath("Glob", { path: dirB }, session).allow).toBe(true);
    });

    it("denies Read on path outside any member", () => {
      const result = checkToolPath("Read", { file_path: "/etc/hosts" }, session);
      expect(result.allow).toBe(false);
      if (!result.allow) {
        expect(result.reason).toContain("不在分组任何成员内");
      }
    });

    it("allows Bash (no path field) even in read-only mode", () => {
      const result = checkToolPath("Bash", { command: "ls" }, session);
      expect(result.allow).toBe(true);
    });

    it("allows Write on elevated member in read-only mode", () => {
      session.elevatedProjectIds = new Set(["p-b"]);
      const file = touch(dirB, "lib/util.ts");
      const result = checkToolPath("Write", { file_path: file }, session);
      expect(result.allow).toBe(true);
    });

    it("denies Write outside any member with no elevation in read-only mode", () => {
      const result = checkToolPath("Edit", { file_path: "/etc/hosts" }, session);
      expect(result.allow).toBe(false);
      if (!result.allow) {
        expect(result.elevation).toBeUndefined();
      }
    });
  });

  describe("path field extraction (PATH_FIELD map)", () => {
    it("ignores tools without path field", () => {
      const session = makeSingleSession("/tmp");
      // Edit without file_path → no guard
      expect(checkToolPath("Edit", {}, session).allow).toBe(true);
      // Edit with non-string file_path → no guard
      expect(checkToolPath("Edit", { file_path: 123 }, session).allow).toBe(true);
      // NotebookEdit without notebook_path → no guard
      expect(checkToolPath("NotebookEdit", {}, session).allow).toBe(true);
      // Grep/Glob without path → no guard
      expect(checkToolPath("Grep", {}, session).allow).toBe(true);
      expect(checkToolPath("Glob", {}, session).allow).toBe(true);
    });
  });
});
