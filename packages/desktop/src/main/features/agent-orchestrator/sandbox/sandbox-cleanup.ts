import { execSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

import type { PipelineRun } from "../../../../shared/features/agent-orchestrator/schemas";

/**
 * 启动时清理孤立的 sandbox 目录。
 */
export function cleanupOrphanSandboxes(sandboxBaseDir: string, activeRunIds: Set<string>): void {
  if (!existsSync(sandboxBaseDir)) return;

  const entries = readdirSync(sandboxBaseDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    // 跳过活跃 run 的 sandbox
    if (activeRunIds.has(entry.name)) continue;

    const dirPath = path.join(sandboxBaseDir, entry.name);
    try {
      rmSync(dirPath, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  }
}

/**
 * 清理 30 天前完成的 Pipeline Run 数据。
 * 包括: run 存储记录、事件日志、sandbox 目录。
 */
export function cleanupExpiredRuns(
  sandboxBaseDir: string,
  runs: PipelineRun[],
  maxAgeDays: number = 30,
): { deletedRuns: number; deletedSandboxes: number } {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let deletedRuns = 0;
  let deletedSandboxes = 0;

  for (const run of runs) {
    // 只清理已完成的 run
    if (!["completed", "failed", "cancelled"].includes(run.status)) continue;

    const completedAt = run.completedAt ? Date.parse(run.completedAt) : Date.parse(run.createdAt);
    if (isNaN(completedAt) || completedAt >= cutoff) continue;

    // 清理 sandbox 目录
    const sandboxPath = path.join(sandboxBaseDir, run.runId);
    if (existsSync(sandboxPath)) {
      try {
        rmSync(sandboxPath, { recursive: true, force: true });
        deletedSandboxes++;
      } catch {
        // 忽略
      }
    }

    // fan-out 子 sandbox 目录
    if (existsSync(sandboxBaseDir)) {
      try {
        const entries = readdirSync(sandboxBaseDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.startsWith(run.runId)) {
            rmSync(path.join(sandboxBaseDir, entry.name), { recursive: true, force: true });
            deletedSandboxes++;
          }
        }
      } catch {
        // 忽略
      }
    }

    deletedRuns++;
  }

  return { deletedRuns, deletedSandboxes };
}

/**
 * 清理指定工作区中孤立的 orchestrator git worktree。
 */
export function cleanupOrphanWorktrees(workspacePath: string): { cleaned: number } {
  if (!existsSync(path.join(workspacePath, ".git"))) return { cleaned: 0 };

  try {
    // 先 prune 无效引用
    execSync(`git -C "${workspacePath}" worktree prune`, { stdio: "pipe" });

    // 查找并删除 orchestrator 相关的孤立分支
    const branches = execSync(`git -C "${workspacePath}" branch`, {
      encoding: "utf-8",
    });
    let cleaned = 0;

    for (const line of branches.split("\n")) {
      const trimmed = line.trim().replace(/^\*\s*/, "");
      if (trimmed.startsWith("orchestrator/run-")) {
        try {
          execSync(`git -C "${workspacePath}" branch -D "${trimmed}" 2>/dev/null || true`, {
            stdio: "pipe",
          });
          cleaned++;
        } catch {
          // 忽略
        }
      }
    }

    return { cleaned };
  } catch {
    return { cleaned: 0 };
  }
}

/**
 * 启动时全面清理：孤立 sandbox + 过期 runs + 孤立 worktree。
 */
export function startupCleanup(
  sandboxBaseDir: string,
  activeRunIds: Set<string>,
  runs: PipelineRun[],
  workspacePath: string,
): {
  orphanSandboxes: number;
  expiredRuns: number;
  orphanWorktrees: number;
} {
  // 孤立 sandbox
  let orphanSandboxCount = 0;
  if (existsSync(sandboxBaseDir)) {
    const before = readdirSync(sandboxBaseDir).length;
    cleanupOrphanSandboxes(sandboxBaseDir, activeRunIds);
    const after = readdirSync(sandboxBaseDir).length;
    orphanSandboxCount = before - after;
  }

  // 过期 runs
  const { deletedRuns, deletedSandboxes: _deletedSandboxes } = cleanupExpiredRuns(
    sandboxBaseDir,
    runs,
  );

  // 孤立 worktree
  const { cleaned } = cleanupOrphanWorktrees(workspacePath);

  return {
    orphanSandboxes: orphanSandboxCount,
    expiredRuns: deletedRuns,
    orphanWorktrees: cleaned,
  };
}
