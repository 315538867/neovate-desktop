import AdmZip from "adm-zip";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PreviewSkill } from "../../../../shared/features/skills/types";

import { BaseSkillInstaller, type FetchResult, type PostProcessContext } from "./base";
import { safeExtractZip } from "./zip-extract";

const CLAWHUB_BASE = "https://clawhub.ai";
const DOWNLOAD_TIMEOUT_MS = 60_000;
const METADATA_TIMEOUT_MS = 10_000;

interface ParsedRef {
  slug: string;
  version?: string;
}

export class ClawhubInstaller extends BaseSkillInstaller<ParsedRef> {
  constructor() {
    super("neovate:skills:clawhub");
  }

  detect(sourceRef: string): boolean {
    return sourceRef.startsWith(`${CLAWHUB_BASE}/`) || sourceRef.startsWith("clawhub:");
  }

  /** Normalize any accepted input to canonical `clawhub:{slug}` format. */
  normalize(sourceRef: string): string {
    const { slug } = this.parseRef(sourceRef);
    return `clawhub:${slug}`;
  }

  protected async fetchToTemp(sourceRef: string, tmpDir: string): Promise<FetchResult<ParsedRef>> {
    const parsed = this.parseRef(sourceRef);
    await mkdir(tmpDir, { recursive: true });
    await this.downloadAndExtract(parsed, tmpDir);
    return { baseDir: tmpDir, info: parsed };
  }

  protected postProcessSkills(
    skills: PreviewSkill[],
    ctx: PostProcessContext<ParsedRef>,
  ): PreviewSkill[] {
    // Replace temp-dir-based names with the slug for root-level skills
    const tmpDirName = path.basename(ctx.tmpDir);
    for (const skill of skills) {
      if (skill.skillPath === "." && skill.name === tmpDirName) {
        skill.name = ctx.info.slug;
      }
    }
    return skills;
  }

  protected async queryLatestVersion(sourceRef: string): Promise<string | undefined> {
    const { slug } = this.parseRef(sourceRef);
    const res = await fetch(`${CLAWHUB_BASE}/api/v1/skills/${slug}`, {
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    return data?.latestVersion?.version ?? undefined;
  }

  private parseRef(sourceRef: string): ParsedRef {
    // clawhub:slug or clawhub:slug@version
    if (sourceRef.startsWith("clawhub:")) {
      const raw = sourceRef.slice("clawhub:".length);
      const atIdx = raw.indexOf("@");
      if (atIdx !== -1) {
        return { slug: raw.slice(0, atIdx), version: raw.slice(atIdx + 1) };
      }
      return { slug: raw };
    }

    // https://clawhub.ai/owner/slug[?version=...]
    const url = new URL(sourceRef);
    const segments = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (segments.length < 2) {
      throw new Error(`Invalid ClawHub URL: expected https://clawhub.ai/{owner}/{slug}`);
    }
    const slug = segments[1]!;
    const version = url.searchParams.get("version") ?? undefined;
    return { slug, version };
  }

  private async downloadAndExtract(parsed: ParsedRef, destDir: string): Promise<void> {
    const params = new URLSearchParams({ slug: parsed.slug });
    if (parsed.version) params.set("version", parsed.version);

    const url = `${CLAWHUB_BASE}/api/v1/download?${params}`;
    this.log("downloading", { url });

    const res = await fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`ClawHub download failed: HTTP ${res.status}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const zipPath = path.join(destDir, "download.zip");
    await writeFile(zipPath, buffer);

    const zip = new AdmZip(zipPath);
    safeExtractZip(zip, destDir);

    // noop: best-effort cleanup of downloaded zip; extraction already succeeded
    await rm(zipPath, { force: true }).catch(() => {});
  }
}
