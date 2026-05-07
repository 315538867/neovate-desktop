/**
 * Agent Orchestrator — WorktreeManager.
 *
 * Creates per-run / per-stage git worktrees as sandboxes. Each entry is
 * keyed by `${runId}#${stageId}` so the orchestrator can resolve the
 * cwd to pass to executors. Cleanup is conservative: we never delete a
 * worktree that the recovery layer might still reference.
 *
 * The implementation shells out to `simple-git` so it shares the same
 * binary path resolution used elsewhere in the app. Tests stub this
 * via the `runner` constructor option.
 */

import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { SandboxSpec } from "../../../../shared/features/agent-orchestrator/types";

export type WorktreeEntry = {
  runId: string;
  stageId: string;
  branchIndex: number;
  path: string;
  branch: string;
  baseCwd: string;
  createdAt: number;
};

export type WorktreeRunner = (cwd: string, args: readonly string[]) => Promise<void>;

export type WorktreeManagerDeps = {
  /** Root directory under which worktrees are created. */
  root: string;
  /** Override the git command runner — defaults to `simple-git`. */
  runner?: WorktreeRunner;
  clock?: () => number;
};

const DEFAULT_BRANCH_TEMPLATE = "orchestrator/{runId}/{stageId}";

export class WorktreeManager {
  private readonly root: string;
  private readonly runner: WorktreeRunner;
  private readonly clock: () => number;
  private readonly entries = new Map<string, WorktreeEntry>();

  constructor(deps: WorktreeManagerDeps) {
    this.root = deps.root;
    this.runner = deps.runner ?? defaultRunner;
    this.clock = deps.clock ?? Date.now;
  }

  /**
   * Create a worktree for the given stage. Idempotent — repeated calls
   * with the same key return the cached entry.
   */
  async ensure(args: {
    runId: string;
    stageId: string;
    branchIndex?: number;
    baseCwd: string;
    spec?: SandboxSpec;
  }): Promise<WorktreeEntry> {
    const branchIndex = args.branchIndex ?? 0;
    const id = `${args.runId}#${args.stageId}#${branchIndex}`;
    const cached = this.entries.get(id);
    if (cached) return cached;

    const branchTemplate = args.spec?.branchTemplate ?? DEFAULT_BRANCH_TEMPLATE;
    const branch = renderBranchName(branchTemplate, args);
    const path = resolve(this.root, args.runId, `${args.stageId}-${branchIndex}`);
    await fs.mkdir(dirname(path), { recursive: true });

    await this.runner(args.baseCwd, ["worktree", "add", "-b", branch, path]);

    const entry: WorktreeEntry = {
      runId: args.runId,
      stageId: args.stageId,
      branchIndex,
      path,
      branch,
      baseCwd: args.baseCwd,
      createdAt: this.clock(),
    };
    this.entries.set(id, entry);
    return entry;
  }

  /** Return the cached entry without creating one. */
  get(runId: string, stageId: string, branchIndex = 0): WorktreeEntry | undefined {
    return this.entries.get(`${runId}#${stageId}#${branchIndex}`);
  }

  /** All entries belonging to a run — used by recovery + cleanup. */
  listByRun(runId: string): WorktreeEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.runId === runId);
  }

  /**
   * Drop a single worktree. We invoke git first; only on success do we
   * forget the entry so the recovery layer can re-trigger cleanup if
   * the process died mid-call.
   */
  async remove(entry: WorktreeEntry): Promise<void> {
    try {
      await this.runner(entry.baseCwd, ["worktree", "remove", "--force", entry.path]);
    } catch {
      // best-effort — sandbox-cleanup will retry orphans at startup
    }
    this.entries.delete(`${entry.runId}#${entry.stageId}#${entry.branchIndex}`);
  }

  async removeRun(runId: string): Promise<void> {
    for (const entry of this.listByRun(runId)) {
      await this.remove(entry);
    }
  }
}

function renderBranchName(
  template: string,
  args: { runId: string; stageId: string; branchIndex?: number },
): string {
  return template
    .replaceAll("{runId}", args.runId)
    .replaceAll("{stageId}", args.stageId)
    .replaceAll("{branchIndex}", String(args.branchIndex ?? 0));
}

async function defaultRunner(cwd: string, args: readonly string[]): Promise<void> {
  // Lazy import keeps the module Node-only without forcing simple-git on
  // every consumer. Tests can supply their own `runner`.
  const { simpleGit } = await import("simple-git");
  const git = simpleGit({ baseDir: cwd });
  await git.raw(...args);
}

/** Convenience entry — exported for sandbox-cleanup helpers. */
export function defaultWorktreeRoot(appDataDir: string): string {
  return join(appDataDir, "orchestrator", "worktrees");
}
