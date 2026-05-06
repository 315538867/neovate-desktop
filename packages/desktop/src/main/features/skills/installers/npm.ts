import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { shellEnvService } from "../../../core/shell-service";
import { BaseSkillInstaller, type FetchResult } from "./base";
import { assertRegistryAllowed } from "./registry-policy";

const execFileAsync = promisify(execFile);

interface NpmInfo {
  pkg: string;
  registry?: string;
}

export class NpmInstaller extends BaseSkillInstaller<NpmInfo> {
  private getDefaultRegistry: () => string | undefined;

  constructor(getDefaultRegistry?: () => string | undefined) {
    super("neovate:skills:npm");
    this.getDefaultRegistry = getDefaultRegistry ?? (() => undefined);
  }

  detect(sourceRef: string): boolean {
    if (sourceRef.startsWith("npm:")) return true;
    if (sourceRef.startsWith("@") && sourceRef.includes("/")) return true;
    return false;
  }

  protected async fetchToTemp(sourceRef: string, tmpDir: string): Promise<FetchResult<NpmInfo>> {
    const { pkg, registry } = this.resolveRegistry(sourceRef);
    await mkdir(tmpDir, { recursive: true });
    await this.fetchAndExtract(pkg, tmpDir, registry);
    // npm pack extracts to a "package" subdirectory
    return { baseDir: path.join(tmpDir, "package"), info: { pkg, registry } };
  }

  protected async queryLatestVersion(sourceRef: string): Promise<string | undefined> {
    const { pkg: rawPkg, registry } = this.resolveRegistry(sourceRef);
    const pkg = rawPkg.replace(/@[\d.]+$/, "");
    const env = await shellEnvService.getEnv();
    const args = ["view", pkg, "version"];
    if (registry) args.push("--registry", registry);
    const { stdout } = await execFileAsync("npm", args, {
      timeout: 15_000,
      env,
    });
    return stdout.trim() || undefined;
  }

  private resolveRegistry(sourceRef: string): { pkg: string; registry?: string } {
    const { pkg, registry } = this.parseSourceRef(sourceRef);
    const effective = registry ?? this.getDefaultRegistry();
    // Wave 4.3 commit 7.4: block attacker-controlled registries before
    // either install (fetchToTemp) or version probe (queryLatestVersion)
    // can shell out to `npm`. Empty string == "use npm default" and is allowed.
    assertRegistryAllowed(effective ?? "");
    return { pkg, registry: effective };
  }

  private parseSourceRef(sourceRef: string): { pkg: string; registry?: string } {
    const raw = sourceRef.replace(/^npm:/, "");
    const qIdx = raw.indexOf("?registry=");
    if (qIdx === -1) return { pkg: raw };
    return {
      pkg: raw.slice(0, qIdx),
      registry: raw.slice(qIdx + "?registry=".length),
    };
  }

  private async fetchAndExtract(pkg: string, destDir: string, registry?: string): Promise<void> {
    const env = await shellEnvService.getEnv();
    // npm pack downloads tarball to cwd
    const args = ["pack", pkg, "--pack-destination", destDir];
    if (registry) args.push("--registry", registry);
    await execFileAsync("npm", args, {
      timeout: 60_000,
      cwd: destDir,
      env,
    });

    // Find the tarball
    const { stdout } = await execFileAsync("ls", [destDir], { env });
    const tarball = stdout.split("\n").find((f) => f.endsWith(".tgz"));
    if (!tarball) throw new Error("Failed to download npm package");

    // Extract
    await execFileAsync("tar", ["xzf", path.join(destDir, tarball), "-C", destDir], { env });
  }
}
