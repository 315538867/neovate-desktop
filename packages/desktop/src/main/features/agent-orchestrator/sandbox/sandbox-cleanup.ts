/**
 * Agent Orchestrator — sandbox cleanup helpers.
 *
 * Called from `Orchestrator.startupCleanup()` to remove orphan
 * worktrees left behind by an unsafe interrupt. The function takes the
 * set of run-ids that recovery still wants to resume and prunes
 * everything else.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";

import type { WorktreeManager } from "./worktree-manager";

export type SandboxCleanupArgs = {
  worktreeManager: WorktreeManager;
  worktreeRoot: string;
  /** Run-ids that recovery still references — never delete these. */
  preserveRunIds: Iterable<string>;
};

export type SandboxCleanupReport = {
  scanned: number;
  removed: string[];
  preserved: string[];
};

export async function cleanupOrphanWorktrees(
  args: SandboxCleanupArgs,
): Promise<SandboxCleanupReport> {
  const preserve = new Set(args.preserveRunIds);
  const report: SandboxCleanupReport = { scanned: 0, removed: [], preserved: [] };

  let entries: string[];
  try {
    entries = await fs.readdir(args.worktreeRoot);
  } catch {
    // Root may not exist yet — first run.
    return report;
  }

  for (const runId of entries) {
    report.scanned++;
    if (preserve.has(runId)) {
      report.preserved.push(runId);
      continue;
    }
    const dir = join(args.worktreeRoot, runId);
    try {
      // Best effort: ask the manager first (it may have a registered
      // entry the recovery layer still references); fall back to fs.rm.
      const tracked = args.worktreeManager.listByRun(runId);
      if (tracked.length > 0) {
        await args.worktreeManager.removeRun(runId);
      }
      await fs.rm(dir, { recursive: true, force: true });
      report.removed.push(runId);
    } catch {
      // Skip — the next startup will retry.
    }
  }

  return report;
}
