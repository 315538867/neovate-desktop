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
  focusProjectId: string,
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
    cwd: members.find((m) => m.projectId === focusProjectId)?.path ?? "/tmp/fallback",
    consumeExited: false,
    uiToSdkMessageIds: new Map(),
    pendingRequests: new Map(),
    createdAt: Date.now(),
    kind: "group",
    groupId: "g1",
    focusProjectId,
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
      session = makeGroupSession("p-a", [
        { projectId: "p-a", path: dirA, name: "ProjectA", role: "consumer", missing: false },
        { projectId: "p-b", path: dirB, name: "ProjectB", role: "library", missing: false },
      ]);
    });

    afterEach(() => {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    });

    it("allows Edit on focus project", () => {
      const file = touch(dirA, "src/index.ts");
      const result = checkToolPath("Edit", { file_path: file }, session);
      expect(result.allow).toBe(true);
    });

    it("denies Write on non-focus member", () => {
      const file = touch(dirB, "lib/util.ts");
      const result = checkToolPath("Write", { file_path: file }, session);
      expect(result.allow).toBe(false);
      if (!result.allow) {
        expect(result.reason).toContain("ProjectB");
        expect(result.reason).toContain("ProjectA");
        expect(result.reason).toContain("可写");
      }
    });

    it("allows Read on non-focus member", () => {
      const file = touch(dirB, "lib/util.ts");
      const result = checkToolPath("Read", { file_path: file }, session);
      expect(result.allow).toBe(true);
    });

    it("allows Grep on non-focus member", () => {
      // dirB itself exists
      const result = checkToolPath("Grep", { path: dirB }, session);
      expect(result.allow).toBe(true);
    });

    it("allows Glob on non-focus member", () => {
      const result = checkToolPath("Glob", { path: dirB }, session);
      expect(result.allow).toBe(true);
    });

    it("denies MultiEdit on non-focus member", () => {
      const file = touch(dirB, "lib/util.ts");
      const result = checkToolPath("MultiEdit", { file_path: file }, session);
      expect(result.allow).toBe(false);
    });

    it("denies NotebookEdit on non-focus member", () => {
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
  });

  describe("missing focus member", () => {
    it("denies all writes when focus is missing", () => {
      const dirA = tmpDir();
      mkdirSync(dirA, { recursive: true });
      const session = makeGroupSession("p-a", [
        { projectId: "p-a", path: null, name: "ProjectA", role: "consumer", missing: true },
        { projectId: "p-b", path: dirA, name: "ProjectB", role: "library", missing: false },
      ]);

      const file = touch(dirA, "foo.ts");
      const result = checkToolPath("Write", { file_path: file }, session);
      expect(result.allow).toBe(false);
      if (!result.allow) {
        expect(result.reason).toContain("聚焦项目已不存在");
      }

      rmSync(dirA, { recursive: true, force: true });
    });

    it("denies all reads when focus is missing", () => {
      const dirB = tmpDir();
      mkdirSync(dirB, { recursive: true });
      const session = makeGroupSession("p-a", [
        { projectId: "p-a", path: null, name: "ProjectA", role: "consumer", missing: true },
        { projectId: "p-b", path: dirB, name: "ProjectB", role: "library", missing: false },
      ]);

      const file = touch(dirB, "readme.md");
      const result = checkToolPath("Read", { file_path: file }, session);
      expect(result.allow).toBe(false);
      if (!result.allow) {
        expect(result.reason).toContain("聚焦项目已不存在");
      }

      rmSync(dirB, { recursive: true, force: true });
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
