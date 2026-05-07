import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PreviewSkill } from "../../../../../shared/features/skills/types";

import { BaseSkillInstaller, type FetchResult, type PostProcessContext } from "../base";

/**
 * Test subclass that exposes the `BaseSkillInstaller` lifecycle without
 * needing real network/git/npm calls. Each instance:
 *   - "fetches" by writing a fake SKILL.md tree under tmpDir
 *   - optionally restricts copy via `getCopyFilter`
 *   - optionally post-processes scanned skills
 */
class FakeInstaller extends BaseSkillInstaller<{ marker: string }> {
  fetchCalls = 0;
  postProcessCalls = 0;

  constructor(
    private readonly skillTree: Record<string, string>,
    opts: {
      filter?: (p: string) => boolean;
      postProcess?: boolean;
      queryVersion?: (sourceRef: string) => Promise<string | undefined>;
    } = {},
  ) {
    super("neovate:test:fake-installer");
    this.copyFilter = opts.filter;
    this.shouldPostProcess = opts.postProcess ?? false;
    if (opts.queryVersion) {
      this.queryLatestVersion = opts.queryVersion;
    }
  }

  private readonly copyFilter?: (p: string) => boolean;
  private readonly shouldPostProcess: boolean;

  detect(sourceRef: string): boolean {
    return sourceRef.startsWith("fake:");
  }

  protected async fetchToTemp(
    _sourceRef: string,
    tmpDir: string,
  ): Promise<FetchResult<{ marker: string }>> {
    this.fetchCalls++;
    await mkdir(tmpDir, { recursive: true });
    for (const [relPath, content] of Object.entries(this.skillTree)) {
      const dest = path.join(tmpDir, relPath);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, content);
    }
    return { baseDir: tmpDir, info: { marker: "test-marker" } };
  }

  protected getCopyFilter(): ((p: string) => boolean) | undefined {
    return this.copyFilter;
  }

  protected postProcessSkills(
    skills: PreviewSkill[],
    ctx: PostProcessContext<{ marker: string }>,
  ): PreviewSkill[] {
    this.postProcessCalls++;
    if (!this.shouldPostProcess) return skills;
    return skills.map((s) => ({ ...s, name: `${s.name}::${ctx.info.marker}` }));
  }
}

const SKILL_MD = `---
name: test-skill
description: A skill used in unit tests
---
Body content
`;

describe("BaseSkillInstaller", () => {
  let targetDir: string;

  beforeEach(async () => {
    targetDir = await mkdtemp(path.join(tmpdir(), "base-installer-test-"));
  });

  afterEach(async () => {
    await rm(targetDir, { recursive: true, force: true }).catch(() => {});
  });

  describe("scan", () => {
    it("returns previewId + scanned skills", async () => {
      const installer = new FakeInstaller({ "SKILL.md": SKILL_MD });
      const { previewId, skills } = await installer.scan("fake:demo");

      expect(previewId).toMatch(/^[a-f0-9-]{36}$/);
      expect(skills).toHaveLength(1);
      expect(skills[0]?.name).toBe("test-skill");
      expect(installer.fetchCalls).toBe(1);
      expect(installer.postProcessCalls).toBe(1);
    });

    it("invokes postProcessSkills hook", async () => {
      const installer = new FakeInstaller({ "SKILL.md": SKILL_MD }, { postProcess: true });
      const { skills } = await installer.scan("fake:demo");
      expect(skills[0]?.name).toBe("test-skill::test-marker");
    });
  });

  describe("installFromPreview", () => {
    it("copies skills from preview baseDir into target", async () => {
      const installer = new FakeInstaller({ "SKILL.md": SKILL_MD });
      const { previewId } = await installer.scan("fake:demo");

      const installed = await installer.installFromPreview(previewId, ["."], targetDir);

      expect(installed).toHaveLength(1);
      const dest = path.join(targetDir, installed[0]!);
      const copiedContent = await readFile(path.join(dest, "SKILL.md"), "utf8");
      expect(copiedContent).toContain("test-skill");
    });

    it("applies getCopyFilter to exclude files", async () => {
      const installer = new FakeInstaller(
        { "SKILL.md": SKILL_MD, ".secret": "should-not-copy" },
        { filter: (p) => path.basename(p) !== ".secret" },
      );
      const { previewId } = await installer.scan("fake:demo");
      const [name] = await installer.installFromPreview(previewId, ["."], targetDir);

      const dest = path.join(targetDir, name!);
      const secretFileExists = await readFile(path.join(dest, ".secret"), "utf8")
        .then(() => true)
        .catch(() => false);
      expect(secretFileExists).toBe(false);
    });

    it("throws when previewId is unknown", async () => {
      const installer = new FakeInstaller({ "SKILL.md": SKILL_MD });
      await expect(
        installer.installFromPreview("does-not-exist", ["."], targetDir),
      ).rejects.toThrow(/Preview not found/);
    });

    it("removes the preview entry after successful install", async () => {
      const installer = new FakeInstaller({ "SKILL.md": SKILL_MD });
      const { previewId } = await installer.scan("fake:demo");
      await installer.installFromPreview(previewId, ["."], targetDir);

      // Second invocation should fail because preview was cleaned up
      await expect(installer.installFromPreview(previewId, ["."], targetDir)).rejects.toThrow(
        /Preview not found/,
      );
    });
  });

  describe("install (one-shot)", () => {
    it("does NOT register a preview entry", async () => {
      const installer = new FakeInstaller({
        "skills/foo/SKILL.md": SKILL_MD.replace("test-skill", "foo"),
      });

      await installer.install("fake:demo", "foo", targetDir);

      const dest = path.join(targetDir, "foo");
      const content = await readFile(path.join(dest, "SKILL.md"), "utf8");
      expect(content).toContain("foo");
    });
  });

  describe("cleanup", () => {
    it("removes the preview tmpDir and the in-memory entry", async () => {
      const installer = new FakeInstaller({ "SKILL.md": SKILL_MD });
      const { previewId } = await installer.scan("fake:demo");

      await installer.cleanup(previewId);

      // Preview is gone, so re-using it should fail
      await expect(installer.installFromPreview(previewId, ["."], targetDir)).rejects.toThrow(
        /Preview not found/,
      );
    });

    it("is a no-op for unknown previewId", async () => {
      const installer = new FakeInstaller({ "SKILL.md": SKILL_MD });
      await expect(installer.cleanup("missing")).resolves.toBeUndefined();
    });
  });

  describe("getLatestVersion", () => {
    it("returns undefined when subclass omits queryLatestVersion", async () => {
      const installer = new FakeInstaller({ "SKILL.md": SKILL_MD });
      const v = await installer.getLatestVersion("fake:demo");
      expect(v).toBeUndefined();
    });

    it("returns the resolved value from queryLatestVersion", async () => {
      const installer = new FakeInstaller(
        { "SKILL.md": SKILL_MD },
        { queryVersion: vi.fn(async () => "1.2.3") },
      );
      const v = await installer.getLatestVersion("fake:demo");
      expect(v).toBe("1.2.3");
    });

    it("converts thrown errors to undefined", async () => {
      const installer = new FakeInstaller(
        { "SKILL.md": SKILL_MD },
        {
          queryVersion: vi.fn(async () => {
            throw new Error("network down");
          }),
        },
      );
      const v = await installer.getLatestVersion("fake:demo");
      expect(v).toBeUndefined();
    });
  });
});
