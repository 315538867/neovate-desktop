/**
 * BaseSkillInstaller — common scaffolding for installers that fetch source
 * into a temp directory, scan it for skill manifests, and copy selected
 * skills into the user's skills folder.
 *
 * Subclasses provide:
 *   - `detect()`            — match the source ref string
 *   - `fetchToTemp()`       — populate the temp dir; return the base dir
 *                             (often `tmpDir` or `tmpDir/<subpath>`) plus
 *                             optional opaque info to thread through.
 *   - optionally:
 *     - `getCopyFilter()`   — exclude paths from cp (e.g. ".git")
 *     - `postProcessSkills()` — adjust scanned skill metadata
 *     - `queryLatestVersion()` — base wraps the call in try/catch
 *
 * `PrebuiltInstaller` is intentionally NOT a subclass — it copies from a
 * fixed local resource directory and never needs the temp-dir lifecycle.
 */

import debug from "debug";
import { randomUUID } from "node:crypto";
import { cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { PreviewSkill } from "../../../../shared/features/skills/types";
import type { SkillInstaller } from "./types";

import {
  deriveInstallName,
  findSkillPath,
  resolveSkillSource,
  scanSkillDirs,
} from "../skill-utils";

/** Stored per-preview state. `info` is opaque to the base class. */
export interface PreviewEntry<TInfo = unknown> {
  tmpDir: string;
  baseDir: string;
  sourceRef: string;
  info: TInfo;
}

export interface FetchResult<TInfo = unknown> {
  /** Directory under `tmpDir` that should be scanned and copied from. */
  baseDir: string;
  /** Subclass-defined metadata threaded into postProcessSkills/cleanup. */
  info: TInfo;
}

export interface PostProcessContext<TInfo> {
  baseDir: string;
  tmpDir: string;
  sourceRef: string;
  info: TInfo;
}

export abstract class BaseSkillInstaller<TInfo = unknown> implements SkillInstaller {
  protected readonly previewDirs = new Map<string, PreviewEntry<TInfo>>();
  protected readonly log: debug.Debugger;

  constructor(debugNs: string) {
    this.log = debug(debugNs);
  }

  abstract detect(sourceRef: string): boolean;

  /** Populate `tmpDir` with the source content. Returns `{ baseDir, info }`. */
  protected abstract fetchToTemp(sourceRef: string, tmpDir: string): Promise<FetchResult<TInfo>>;

  /** Subclass hook for cp filter; default copies everything. */
  protected getCopyFilter(): ((p: string) => boolean) | undefined {
    return undefined;
  }

  /** Subclass hook to mutate scanned skills (e.g. rename root entries). */
  protected postProcessSkills(
    skills: PreviewSkill[],
    _ctx: PostProcessContext<TInfo>,
  ): PreviewSkill[] {
    return skills;
  }

  /**
   * Subclass hook: query upstream version. Failures should THROW so that
   * `getLatestVersion` can convert them to `undefined` consistently.
   */
  protected queryLatestVersion?(sourceRef: string): Promise<string | undefined>;

  async scan(sourceRef: string): Promise<{ previewId: string; skills: PreviewSkill[] }> {
    this.log("scan", { sourceRef });
    const previewId = randomUUID();
    const tmpDir = path.join(tmpdir(), `neovate-skill-preview-${previewId}`);

    const { baseDir, info } = await this.fetchToTemp(sourceRef, tmpDir);
    this.previewDirs.set(previewId, { tmpDir, baseDir, sourceRef, info });

    const skills = await scanSkillDirs(baseDir);
    return {
      previewId,
      skills: this.postProcessSkills(skills, { baseDir, tmpDir, sourceRef, info }),
    };
  }

  async install(sourceRef: string, skillName: string, targetDir: string): Promise<void> {
    this.log("install", { sourceRef, skillName, targetDir });
    const tmpId = randomUUID();
    const tmpDir = path.join(tmpdir(), `neovate-skill-preview-${tmpId}`);

    try {
      const { baseDir } = await this.fetchToTemp(sourceRef, tmpDir);
      const skillPath = await findSkillPath(baseDir, skillName);
      const src = resolveSkillSource(baseDir, skillPath);
      const destName = deriveInstallName(skillName, sourceRef);
      const dest = path.join(targetDir, destName);
      await cp(src, dest, { recursive: true, filter: this.getCopyFilter() });
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async installFromPreview(
    previewId: string,
    skillPaths: string[],
    targetDir: string,
  ): Promise<string[]> {
    this.log("installFromPreview", { previewId, skillPaths });
    const preview = this.previewDirs.get(previewId);
    if (!preview) throw new Error("Preview not found or expired");

    const installed: string[] = [];
    const filter = this.getCopyFilter();
    for (const sp of skillPaths) {
      const destName = deriveInstallName(sp, preview.sourceRef);
      const src = resolveSkillSource(preview.baseDir, sp);
      const dest = path.join(targetDir, destName);
      await cp(src, dest, { recursive: true, filter });
      installed.push(destName);
    }

    await this.cleanup(previewId);
    return installed;
  }

  async cleanup(previewId: string): Promise<void> {
    const preview = this.previewDirs.get(previewId);
    if (preview) {
      await rm(preview.tmpDir, { recursive: true, force: true }).catch(() => {});
      this.previewDirs.delete(previewId);
    }
  }

  async getLatestVersion(sourceRef: string): Promise<string | undefined> {
    if (!this.queryLatestVersion) return undefined;
    this.log("getLatestVersion", { sourceRef });
    try {
      return await this.queryLatestVersion(sourceRef);
    } catch {
      return undefined;
    }
  }
}
