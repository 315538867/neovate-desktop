import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { shellEnvService } from "../../../core/shell-service";
import { BaseSkillInstaller, type FetchResult } from "./base";

const execFileAsync = promisify(execFile);

interface GitInfo {
  url: string;
  branch?: string;
  subpath?: string;
}

export class GitInstaller extends BaseSkillInstaller<GitInfo> {
  constructor() {
    super("neovate:skills:git");
  }

  detect(sourceRef: string): boolean {
    if (sourceRef.startsWith("prebuilt:") || sourceRef.startsWith("npm:")) return false;
    // Match git: prefix, URLs with .git, or github/gitlab patterns
    if (sourceRef.startsWith("git:")) return true;
    if (/^https?:\/\//.test(sourceRef)) return true;
    if (/^[\w.-]+\/[\w.-]+$/.test(sourceRef)) return true; // user/repo shorthand
    return false;
  }

  protected async fetchToTemp(sourceRef: string, tmpDir: string): Promise<FetchResult<GitInfo>> {
    const env = await shellEnvService.getEnv();
    const { url, branch, subpath } = this.parseSourceRef(sourceRef);
    await this.cloneRepo({ url, branch, subpath, tmpDir, env });
    const baseDir = subpath ? path.join(tmpDir, subpath) : tmpDir;
    return { baseDir, info: { url, branch, subpath } };
  }

  protected getCopyFilter(): (p: string) => boolean {
    return (s) => path.basename(s) !== ".git";
  }

  protected async queryLatestVersion(sourceRef: string): Promise<string | undefined> {
    const env = await shellEnvService.getEnv();
    const { url } = this.parseSourceRef(sourceRef);
    const { stdout } = await execFileAsync("git", ["ls-remote", url, "HEAD"], {
      timeout: 15_000,
      env,
    });
    const sha = stdout.split("\t")[0];
    return sha ? sha.slice(0, 7) : undefined;
  }

  /** Clean up any stale preview directories */
  cleanupStale(): void {
    for (const [id, { tmpDir }] of this.previewDirs) {
      rm(tmpDir, { recursive: true, force: true })
        .then(() => this.previewDirs.delete(id))
        .catch(() => {});
    }
  }

  private parseSourceRef(sourceRef: string): GitInfo {
    const raw = sourceRef.replace(/^git:/, "");

    // user/repo shorthand → github URL
    if (/^[\w.-]+\/[\w.-]+$/.test(raw)) {
      return { url: `https://github.com/${raw}.git` };
    }

    // GitHub/GitLab/Bitbucket tree URLs: .../tree/<branch>[/<subpath>]
    const treeMatch = raw.match(
      /^(https?:\/\/[^/]+\/[^/]+\/[^/]+?)(?:\.git)?\/tree\/([^/]+)(?:\/(.+))?$/,
    );
    if (treeMatch) {
      const url = `${treeMatch[1]}.git`;
      const branch = treeMatch[2]!;
      const subpath = treeMatch[3]?.replace(/\/+$/, ""); // strip trailing slashes
      return { url, branch, subpath: subpath || undefined };
    }

    return { url: raw };
  }

  private async cloneRepo(opts: {
    url: string;
    branch?: string;
    subpath?: string;
    tmpDir: string;
    env: Record<string, string>;
  }): Promise<void> {
    const { url, branch, subpath, tmpDir, env } = opts;

    if (subpath) {
      // Sparse checkout: only download files under the subpath
      const cloneArgs = ["clone", "--depth", "1", "--filter=blob:none", "--sparse"];
      if (branch) cloneArgs.push("--branch", branch);
      cloneArgs.push(url, tmpDir);
      await execFileAsync("git", cloneArgs, { timeout: 60_000, env });
      await execFileAsync("git", ["-C", tmpDir, "sparse-checkout", "set", subpath], {
        timeout: 30_000,
        env,
      });
    } else {
      const cloneArgs = ["clone", "--depth", "1"];
      if (branch) cloneArgs.push("--branch", branch);
      cloneArgs.push(url, tmpDir);
      await execFileAsync("git", cloneArgs, { timeout: 60_000, env });
    }
  }
}
