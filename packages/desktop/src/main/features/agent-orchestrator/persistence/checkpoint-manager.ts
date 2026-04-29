import type Store from "electron-store";

import type { StageCheckpoint } from "../../../../shared/features/agent-orchestrator/schemas";
import type { StorageService } from "../../../core/storage-service";

export class CheckpointManager {
  private store: Store;

  constructor(storage: StorageService) {
    this.store = storage.scoped("orchestrator/checkpoints");
  }

  private key(runId: string, instanceId: string): string {
    return `${runId}:${instanceId}`;
  }

  save(runId: string, instanceId: string, checkpoint: StageCheckpoint): void {
    this.store.set(this.key(runId, instanceId), checkpoint);
  }

  get(runId: string, instanceId: string): StageCheckpoint | undefined {
    return this.store.get(this.key(runId, instanceId)) as StageCheckpoint | undefined;
  }

  remove(runId: string, instanceId: string): void {
    this.store.delete(this.key(runId, instanceId));
  }

  removeAll(runId: string): void {
    const prefix = `${runId}:`;
    for (const key of Object.keys(this.store.store)) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }
}
