import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { InstallMeta } from "../../../../shared/features/skills/types";

import { scanInstalledSkills } from "../skill-utils";

const SKILL_BODY = `---
name: example
description: Example skill
---

Body text.
`;

async function writeSkill(
  baseDir: string,
  dirName: string,
  meta?: Partial<InstallMeta>,
  options: { disabled?: boolean } = {},
): Promise<void> {
  const skillDir = path.join(baseDir, dirName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, options.disabled ? "SKILL.md.disabled" : "SKILL.md"),
    SKILL_BODY,
  );
  if (meta) {
    const fullMeta: InstallMeta = {
      installedFrom: meta.installedFrom ?? "https://example.com/skill.git",
      version: meta.version ?? "1.0.0",
      source: meta.source ?? "git",
      installedAt: meta.installedAt ?? new Date().toISOString(),
      skillPath: meta.skillPath,
    };
    await writeFile(
      path.join(skillDir, ".neovate-install.json"),
      JSON.stringify(fullMeta, null, 2),
    );
  }
}

describe("skill-utils / scanInstalledSkills source field", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(tmpdir(), "skill-utils-test-"));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("propagates source='git' from InstallMeta into SkillMeta", async () => {
    await writeSkill(baseDir, "git-skill", { source: "git", version: "2.1.0" });

    const skills = await scanInstalledSkills(baseDir, "global");

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      dirName: "git-skill",
      source: "git",
      version: "2.1.0",
      installedFrom: "https://example.com/skill.git",
    });
  });

  it("propagates source='npm' from InstallMeta", async () => {
    await writeSkill(baseDir, "npm-skill", {
      source: "npm",
      installedFrom: "npm:@scope/skill@1.0.0",
    });

    const [skill] = await scanInstalledSkills(baseDir, "global");
    expect(skill?.source).toBe("npm");
  });

  it("propagates source='clawhub' from InstallMeta", async () => {
    await writeSkill(baseDir, "clawhub-skill", {
      source: "clawhub",
      installedFrom: "clawhub:owner/skill",
    });

    const [skill] = await scanInstalledSkills(baseDir, "global");
    expect(skill?.source).toBe("clawhub");
  });

  it("propagates source='prebuilt' from InstallMeta", async () => {
    await writeSkill(baseDir, "prebuilt-skill", { source: "prebuilt" });

    const [skill] = await scanInstalledSkills(baseDir, "global");
    expect(skill?.source).toBe("prebuilt");
  });

  it("returns source=undefined for skills with no InstallMeta", async () => {
    await writeSkill(baseDir, "user-skill"); // no meta argument

    const [skill] = await scanInstalledSkills(baseDir, "global");
    expect(skill?.source).toBeUndefined();
    expect(skill?.installedFrom).toBeUndefined();
    expect(skill?.version).toBeUndefined();
  });

  it("handles a mixed directory containing skills from multiple sources", async () => {
    await writeSkill(baseDir, "git-skill", { source: "git" });
    await writeSkill(baseDir, "npm-skill", { source: "npm" });
    await writeSkill(baseDir, "clawhub-skill", { source: "clawhub" });
    await writeSkill(baseDir, "user-skill"); // no meta

    const skills = await scanInstalledSkills(baseDir, "global");

    expect(skills).toHaveLength(4);
    const bySource = new Map(skills.map((s) => [s.dirName, s.source]));
    expect(bySource.get("git-skill")).toBe("git");
    expect(bySource.get("npm-skill")).toBe("npm");
    expect(bySource.get("clawhub-skill")).toBe("clawhub");
    expect(bySource.get("user-skill")).toBeUndefined();
  });

  it("preserves source on disabled skills (SKILL.md.disabled)", async () => {
    await writeSkill(baseDir, "disabled-skill", { source: "git" }, { disabled: true });

    const [skill] = await scanInstalledSkills(baseDir, "global");
    expect(skill?.enabled).toBe(false);
    expect(skill?.source).toBe("git");
  });

  it("ignores malformed InstallMeta and returns source=undefined", async () => {
    const skillDir = path.join(baseDir, "broken");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), SKILL_BODY);
    await writeFile(path.join(skillDir, ".neovate-install.json"), "{ this is not json");

    const [skill] = await scanInstalledSkills(baseDir, "global");
    expect(skill?.source).toBeUndefined();
  });

  it("threads scope and projectPath through to SkillMeta untouched", async () => {
    await writeSkill(baseDir, "scoped-skill", { source: "git" });

    const [skill] = await scanInstalledSkills(baseDir, "project", "/some/project");
    expect(skill?.scope).toBe("project");
    expect(skill?.projectPath).toBe("/some/project");
    expect(skill?.source).toBe("git");
  });
});
