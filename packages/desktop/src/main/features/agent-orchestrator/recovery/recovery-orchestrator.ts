/**
 * Agent Orchestrator — Recovery service.
 *
 * Provides the three operations the orchestrator façade needs around a
 * crash:
 *   • `markInterruptedAtStartup()`  — flip stale `running` rows to
 *                                       `interrupted_unsafe`.
 *   • `markGracefulShutdown(runId)` — flip live `running` rows to
 *                                       `interrupted_graceful` from the
 *                                       Electron `before-quit` hook.
 *   • `listRecoverable()`           — surface graceful + unsafe +
 *                                       gate-paused runs to the UI.
 *
 * Keep this layer thin: actual resume orchestration (executor restart,
 * preamble injection, sandbox decisions) lives in the orchestrator
 * façade in commit 2.5 — the recovery service only hands it context.
 */

import type {
  RecoverableRun,
  Run,
  RunStatus,
} from "../../../../shared/features/agent-orchestrator/types";
import type { CheckpointManager } from "../persistence/checkpoint-manager";
import type { RunStore } from "../persistence/run-store";

const RECOVERABLE_STATUSES: ReadonlyArray<RunStatus> = [
  "interrupted_graceful",
  "interrupted_unsafe",
  "paused_user_gate",
];

export type SandboxLookup = (run: Run) => string | undefined;

export type RecoveryServiceDeps = {
  runStore: RunStore;
  checkpointManager: CheckpointManager;
  /**
   * Optional resolver from a Run → sandbox path. Defaults to
   * `undefined` because the worktree manager (commit 2.5) is the
   * authoritative source.
   */
  sandboxLookup?: SandboxLookup;
  /** Override for deterministic tests. */
  clock?: () => number;
};

export class RecoveryService {
  private readonly runStore: RunStore;
  private readonly checkpointManager: CheckpointManager;
  private readonly sandboxLookup: SandboxLookup;
  private readonly clock: () => number;

  constructor(deps: RecoveryServiceDeps) {
    this.runStore = deps.runStore;
    this.checkpointManager = deps.checkpointManager;
    this.sandboxLookup = deps.sandboxLookup ?? (() => undefined);
    this.clock = deps.clock ?? Date.now;
  }

  markInterruptedAtStartup(): { marked: number } {
    const marked = this.runStore.markRunningAsInterruptedUnsafe(this.clock());
    return { marked };
  }

  markGracefulShutdown(runId: string): void {
    const run = this.runStore.get(runId);
    if (!run) return;
    if (run.status !== "running" && run.status !== "paused_user_gate") return;
    run.status = "interrupted_graceful";
    run.completedAt = this.clock();
    this.runStore.save(run);
  }

  listRecoverable(): RecoverableRun[] {
    const seen = new Set<string>();
    const result: RecoverableRun[] = [];
    for (const status of RECOVERABLE_STATUSES) {
      for (const run of this.runStore.findByStatus(status)) {
        if (seen.has(run.id)) continue;
        seen.add(run.id);
        result.push(this.toRecoverable(run));
      }
    }
    result.sort((a, b) => b.interruptedAt - a.interruptedAt);
    return result;
  }

  toRecoverable(run: Run): RecoverableRun {
    return {
      runId: run.id,
      templateId: run.templateId,
      cwd: run.cwd,
      lastStatus: run.status,
      lastStageId: run.currentStageId,
      hasCheckpoint: this.checkpointManager.list(run.id).length > 0,
      sandboxPath: this.sandboxLookup(run),
      interruptedAt: run.completedAt ?? run.startedAt,
    };
  }
}
