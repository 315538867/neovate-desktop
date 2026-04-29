import { existsSync } from "node:fs";

import type { StageRunRecord } from "../../../../shared/features/agent-orchestrator/schemas";

export interface SandboxValidationResult {
  valid: boolean;
  checks: Array<{ check: string; passed: boolean; detail?: string }>;
}

export class SandboxValidator {
  /**
   * 校验沙箱/工作区是否仍然有效
   */
  validate(workspacePath: string, _stage: StageRunRecord): SandboxValidationResult {
    const checks: SandboxValidationResult["checks"] = [];

    // 1. 工作区路径存在
    const pathExists = existsSync(workspacePath);
    checks.push({
      check: "workspace_path_exists",
      passed: pathExists,
      detail: pathExists ? undefined : `Path not found: ${workspacePath}`,
    });

    // 2. 是否为 git 仓库
    const isGit = existsSync(`${workspacePath}/.git`);
    checks.push({
      check: "is_git_repo",
      passed: isGit,
      detail: isGit ? undefined : "Not a git repository",
    });

    // 3. 工作区是否可写
    let writable = false;
    try {
      const { accessSync, constants } = require("node:fs") as typeof import("node:fs");
      accessSync(workspacePath, constants.W_OK);
      writable = true;
    } catch {
      // 不可写
    }
    checks.push({
      check: "workspace_writable",
      passed: writable,
      detail: writable ? undefined : "Workspace is not writable",
    });

    return {
      valid: checks.every((c) => c.passed),
      checks,
    };
  }
}
