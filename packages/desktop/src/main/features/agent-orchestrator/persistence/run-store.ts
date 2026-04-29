import type Store from "electron-store";

import type { PipelineRun } from "../../../../shared/features/agent-orchestrator/schemas";
import type { StorageService } from "../../../core/storage-service";

export class RunStore {
  private store: Store;

  constructor(storage: StorageService) {
    this.store = storage.scoped("orchestrator/runs");
  }

  save(run: PipelineRun): void {
    this.store.set(run.runId, run);
  }

  get(runId: string): PipelineRun | undefined {
    return this.store.get(runId) as PipelineRun | undefined;
  }

  delete(runId: string): void {
    this.store.delete(runId);
  }

  list(filter?: { projectPath?: string }): PipelineRun[] {
    const runs: PipelineRun[] = [];
    for (const [key, value] of Object.entries(this.store.store)) {
      if (key === "___internal") continue;
      const run = value as PipelineRun;
      if (filter?.projectPath && !run.workspacePath.startsWith(filter.projectPath)) continue;
      runs.push(run);
    }
    return runs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  listRecoverable(): PipelineRun[] {
    const recoverable: PipelineRunStatus[] = [
      "paused",
      "interrupted_graceful",
      "interrupted_crashed",
      "stalled",
      "awaiting_user",
    ];
    return this.list().filter((r) => recoverable.includes(r.status));
  }
}

const _recoverable: PipelineRunStatus[] = [];
type PipelineRunStatus =
  import("../../../../shared/features/agent-orchestrator/schemas").PipelineRunStatus;
void _recoverable;
