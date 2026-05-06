/**
 * Agent Orchestrator — fan-out conflict detector.
 *
 * Multiple parallel branches may write to the same paths inside the
 * worktree sandbox. A naive "last write wins" merge would silently
 * corrupt one branch's output, so we detect overlaps before fan-in
 * and surface them as a recoverable error (the user picks which
 * branch's writes to keep, or rejects the fan-in entirely).
 *
 * The detector consumes the recorded `changedFiles` of each branch
 * and returns a conflict map keyed by file path → branch indices.
 */

import type { StageOutput } from "../../../../shared/features/agent-orchestrator/types";

export type FanoutBranchOutput = {
  branchIndex: number;
  output: StageOutput;
};

export type FileConflict = {
  /** Normalised file path (POSIX separators, project-relative). */
  path: string;
  /** Branches that wrote to this path. */
  branches: number[];
};

export type ConflictReport = {
  conflicts: readonly FileConflict[];
  /** Files written by exactly one branch — safe to merge as-is. */
  uniquePaths: readonly string[];
};

/**
 * Detect conflicts across parallel branches.
 *
 * Pure / synchronous; the orchestrator calls this with branch outputs
 * after fan-out completion and before fan-in aggregation.
 */
export function detectConflicts(branches: FanoutBranchOutput[]): ConflictReport {
  const writers = new Map<string, number[]>();
  for (const { branchIndex, output } of branches) {
    for (const raw of output.changedFiles ?? []) {
      const path = normalisePath(raw);
      const list = writers.get(path);
      if (list) list.push(branchIndex);
      else writers.set(path, [branchIndex]);
    }
  }
  const conflicts: FileConflict[] = [];
  const uniquePaths: string[] = [];
  for (const [path, branchList] of writers) {
    if (branchList.length > 1) {
      conflicts.push({
        path,
        branches: dedupeSorted(branchList),
      });
    } else {
      uniquePaths.push(path);
    }
  }
  conflicts.sort((a, b) => a.path.localeCompare(b.path));
  uniquePaths.sort();
  return { conflicts, uniquePaths };
}

function normalisePath(p: string): string {
  // Convert backslashes (Windows worktree paths) and collapse repeated /'s.
  return p
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\.\//, "");
}

function dedupeSorted(arr: number[]): number[] {
  const set = new Set(arr);
  return Array.from(set).sort((a, b) => a - b);
}
