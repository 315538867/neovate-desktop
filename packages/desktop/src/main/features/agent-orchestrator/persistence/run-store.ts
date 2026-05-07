/**
 * Agent Orchestrator — Run record store.
 *
 * Backed by `StorageService.scoped("orchestrator/runs")` (electron-store
 * JSON file). Holds full Run records keyed by `runId`. The dashboard /
 * sidebar reads `RunSummary[]` via `list()` (a smaller projection).
 *
 * The class is deliberately stateless beyond the underlying store — every
 * call rereads the JSON file. If volume becomes a bottleneck we'll move
 * to per-run files (one JSON per run) without changing the public API.
 */

import type Store from "electron-store";

import type {
  Run,
  RunStatus,
  RunSummary,
} from "../../../../shared/features/agent-orchestrator/types";
import type { IStorageService } from "../../../core/storage-service";

export type RunListFilter = {
  projectId?: string;
  status?: RunStatus[];
  limit?: number;
};

export class RunStore {
  static readonly NAMESPACE = "orchestrator/runs";

  constructor(private readonly storage: IStorageService) {}

  save(run: Run): void {
    if (typeof run.id !== "string" || run.id.length === 0) {
      throw new Error("RunStore.save: run.id must be a non-empty string");
    }
    this.store().set(run.id, run);
  }

  get(runId: string): Run | undefined {
    return this.store().get(runId) as Run | undefined;
  }

  list(filter: RunListFilter = {}): RunSummary[] {
    let runs = this.allRuns();
    if (filter.projectId !== undefined) {
      runs = runs.filter((r) => r.projectId === filter.projectId);
    }
    if (filter.status && filter.status.length > 0) {
      const allowed = new Set<RunStatus>(filter.status);
      runs = runs.filter((r) => allowed.has(r.status));
    }
    runs.sort((a, b) => b.startedAt - a.startedAt);
    if (filter.limit !== undefined) runs = runs.slice(0, filter.limit);
    return runs.map(toSummary);
  }

  delete(runId: string): void {
    this.store().delete(runId);
  }

  setStatus(runId: string, status: RunStatus, completedAt?: number): void {
    const run = this.get(runId);
    if (!run) return;
    run.status = status;
    if (completedAt !== undefined) run.completedAt = completedAt;
    this.save(run);
  }

  findByStatus(...statuses: RunStatus[]): Run[] {
    if (statuses.length === 0) return this.allRuns();
    const allowed = new Set<RunStatus>(statuses);
    return this.allRuns().filter((r) => allowed.has(r.status));
  }

  /**
   * Startup helper: anything still labelled `running` or
   * `paused_user_gate` could not have completed gracefully. Mark them
   * `interrupted_unsafe` so the recovery UI surfaces them.
   */
  markRunningAsInterruptedUnsafe(now: number = Date.now()): number {
    let count = 0;
    for (const run of this.findByStatus("running", "paused_user_gate")) {
      run.status = "interrupted_unsafe";
      run.completedAt = run.completedAt ?? now;
      this.save(run);
      count++;
    }
    return count;
  }

  private allRuns(): Run[] {
    const data = (this.store().store ?? {}) as Record<string, unknown>;
    const runs: Run[] = [];
    for (const [key, value] of Object.entries(data)) {
      if (!value || typeof value !== "object") continue;
      const candidate = value as Partial<Run>;
      // Skip electron-store internal nodes (e.g. `__internal__` migrations
      // metadata) and any malformed entries lacking a valid id/status.
      if (typeof candidate.id !== "string" || candidate.id !== key) continue;
      if (typeof candidate.status !== "string") continue;
      runs.push(candidate as Run);
    }
    return runs;
  }

  private store(): Store {
    return this.storage.scoped(RunStore.NAMESPACE);
  }
}

function toSummary(run: Run): RunSummary {
  let completed = 0;
  for (const exec of run.executions) {
    if (exec.status === "succeeded") completed++;
  }
  return {
    id: run.id,
    templateId: run.templateId,
    templateVersion: run.templateVersion,
    projectId: run.projectId,
    cwd: run.cwd,
    status: run.status,
    currentStageId: run.currentStageId,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    budgetUsage: run.budgetUsage,
    completedStageCount: completed,
    totalStageCount: run.executions.length,
  };
}
