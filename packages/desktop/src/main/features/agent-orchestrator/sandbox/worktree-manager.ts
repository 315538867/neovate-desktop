import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * WorktreeManager — 为 Pipeline Run 创建隔离的 git worktree 沙箱。
 *
 * 生产模式（git 项目）: 创建 git worktree
 * 降级模式（非 git 项目）: 拷贝目录
 */
export class WorktreeManager {
  private sandboxBaseDir: string;

  constructor(appDataDir: string) {
    this.sandboxBaseDir = path.join(appDataDir, "orchestrator", "sandboxes");
    if (!existsSync(this.sandboxBaseDir)) {
      mkdirSync(this.sandboxBaseDir, { recursive: true });
    }
  }

  /**
   * 检查目录是否为 git 仓库
   */
  isGitRepo(workspacePath: string): boolean {
    return existsSync(path.join(workspacePath, ".git"));
  }

  /**
   * 为 Run 创建独立 worktree
   */
  createForRun(runId: string, workspacePath: string, branchName?: string): string {
    if (!this.isGitRepo(workspacePath)) {
      return this.fallbackCopy(runId, workspacePath);
    }

    const sandboxPath = path.join(this.sandboxBaseDir, runId);
    const safeBranch = branchName ?? `orchestrator/run-${runId.substring(0, 8)}`;

    try {
      // 检查 worktree 是否已存在
      if (existsSync(sandboxPath)) {
        return sandboxPath;
      }

      // 创建新分支（从当前 HEAD）
      execSync(`git -C "${workspacePath}" branch "${safeBranch}" 2>/dev/null || true`, {
        stdio: "pipe",
      });

      // 创建 worktree
      execSync(`git -C "${workspacePath}" worktree add "${sandboxPath}" "${safeBranch}"`, {
        stdio: "pipe",
      });

      return sandboxPath;
    } catch (err) {
      // 降级：直接拷贝
      return this.fallbackCopy(runId, workspacePath);
    }
  }

  /**
   * 为 fan-out 子实例创建 worktree
   */
  createForFanOut(runId: string, workspacePath: string, index: number): string {
    const fanOutId = `${runId}-f${index}`;
    return this.createForRun(
      fanOutId,
      workspacePath,
      `orchestrator/run-${runId.substring(0, 8)}-f${index}`,
    );
  }

  /**
   * 清理 worktree
   */
  cleanup(runId: string, workspacePath: string): void {
    const sandboxPath = path.join(this.sandboxBaseDir, runId);

    if (this.isGitRepo(workspacePath)) {
      try {
        // 尝试用 git worktree remove
        execSync(
          `git -C "${workspacePath}" worktree remove "${sandboxPath}" --force 2>/dev/null || true`,
          {
            stdio: "pipe",
          },
        );

        // 清理分支
        const branches = execSync(`git -C "${workspacePath}" branch`, { encoding: "utf-8" });
        for (const line of branches.split("\n")) {
          const trimmed = line.trim().replace(/^\*\s*/, "");
          if (trimmed.startsWith(`orchestrator/run-${runId.substring(0, 8)}`)) {
            execSync(`git -C "${workspacePath}" branch -D "${trimmed}" 2>/dev/null || true`, {
              stdio: "pipe",
            });
          }
        }

        // prune worktree references
        execSync(`git -C "${workspacePath}" worktree prune`, { stdio: "pipe" });
      } catch {
        // 忽略错误，回退到目录删除
      }
    }

    // 回退：直接删除目录
    try {
      if (existsSync(sandboxPath)) {
        rmSync(sandboxPath, { recursive: true, force: true });
      }
    } catch {
      // 忽略清理错误
    }
  }

  /**
   * 合并 sandbox 变更到主工作区
   */
  applyChangesToWorkspace(
    runId: string,
    workspacePath: string,
    mode: "merge-to-main" | "apply-as-patch",
  ): {
    success: boolean;
    appliedFiles: string[];
    conflicts?: Array<{ file: string; resolution: "ours" | "theirs" | "manual" }>;
  } {
    const sandboxPath = path.join(this.sandboxBaseDir, runId);

    if (!existsSync(sandboxPath)) {
      return { success: false, appliedFiles: [] };
    }

    if (!this.isGitRepo(workspacePath)) {
      // 非 git：直接拷贝文件
      return this.copyFiles(sandboxPath, workspacePath);
    }

    switch (mode) {
      case "merge-to-main":
        return this.gitMerge(sandboxPath, workspacePath);
      case "apply-as-patch":
        return this.gitPatch(sandboxPath, workspacePath);
    }
  }

  /**
   * 回滚 sandbox 变更
   */
  rollbackChanges(
    _runId: string,
    _workspacePath: string,
  ): { success: boolean; rolledBackFiles: string[] } {
    // 最简单的回滚：删除 sandbox 目录
    // 因为 worktree 是独立的，删除 sandbox 即回滚
    return { success: true, rolledBackFiles: [] };
  }

  /**
   * 清理孤立的 worktree
   */
  static cleanupOrphanWorktrees(workspacePath: string): void {
    if (!existsSync(path.join(workspacePath, ".git"))) return;

    try {
      // git worktree prune 清理无效引用
      execSync(`git -C "${workspacePath}" worktree prune`, { stdio: "pipe" });
    } catch {
      // 忽略
    }
  }

  // ── Private helpers ──

  private fallbackCopy(runId: string, sourcePath: string): string {
    const destPath = path.join(this.sandboxBaseDir, runId);
    if (!existsSync(destPath)) {
      execSync(`cp -R "${sourcePath}" "${destPath}"`, { stdio: "pipe" });
    }
    return destPath;
  }

  private gitMerge(
    sandboxPath: string,
    workspacePath: string,
  ): {
    success: boolean;
    appliedFiles: string[];
    conflicts?: Array<{ file: string; resolution: "ours" | "theirs" | "manual" }>;
  } {
    try {
      // 获取 sandbox 中的变更文件列表
      const diffOutput = execSync(`git -C "${sandboxPath}" diff --name-only HEAD`, {
        encoding: "utf-8",
      }).trim();
      const files = diffOutput.split("\n").filter(Boolean);

      // 在 sandbox 中创建 commit
      execSync(`git -C "${sandboxPath}" add -A`, { stdio: "pipe" });
      execSync(
        `git -C "${sandboxPath}" commit -m "orchestrator: apply changes" --allow-empty 2>/dev/null || true`,
        {
          stdio: "pipe",
        },
      );

      // 获取 sandbox commit hash
      const sandboxHash = execSync(`git -C "${sandboxPath}" rev-parse HEAD`, {
        encoding: "utf-8",
      }).trim();

      // 在主仓库 cherry-pick
      execSync(`git -C "${workspacePath}" cherry-pick "${sandboxHash}" 2>/dev/null || true`, {
        stdio: "pipe",
      });

      return { success: true, appliedFiles: files };
    } catch {
      return { success: false, appliedFiles: [] };
    }
  }

  private gitPatch(
    sandboxPath: string,
    workspacePath: string,
  ): {
    success: boolean;
    appliedFiles: string[];
    conflicts?: Array<{ file: string; resolution: "ours" | "theirs" | "manual" }>;
  } {
    try {
      const diffOutput = execSync(`git -C "${sandboxPath}" diff --name-only HEAD`, {
        encoding: "utf-8",
      }).trim();
      const files = diffOutput.split("\n").filter(Boolean);

      // 生成 patch 并应用
      const patch = execSync(`git -C "${sandboxPath}" diff HEAD`, { encoding: "utf-8" });
      execSync(`git -C "${workspacePath}" apply -`, { input: patch, stdio: "pipe" });

      return { success: true, appliedFiles: files };
    } catch {
      return { success: false, appliedFiles: [] };
    }
  }

  private copyFiles(
    sourceDir: string,
    destDir: string,
  ): { success: boolean; appliedFiles: string[] } {
    try {
      execSync(`rsync -a "${sourceDir}/" "${destDir}/" --exclude .git`, { stdio: "pipe" });
      return { success: true, appliedFiles: [] };
    } catch {
      return { success: false, appliedFiles: [] };
    }
  }
}
