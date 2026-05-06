/**
 * Agent Orchestrator — Per-stage interim outputs.
 *
 * `ClaudeCodeExecutor` may flush incremental output before a stage
 * finishes (tool-call summaries, partial diffs, etc.). When the process
 * crashes mid-stage, `recovery/recovery-orchestrator.ts` reads these
 * partials so the resume preamble can quote prior progress.
 *
 * Keys are `${runId}#${stageId}#${branchIndex}` — flat namespace so
 * `clearRun()` can prefix-scan without a separate index.
 */

import type Store from "electron-store";

import type { StageOutput } from "../../../../shared/features/agent-orchestrator/types";
import type { IStorageService } from "../../../core/storage-service";

export type PartialOutputKey = {
  runId: string;
  stageId: string;
  branchIndex: number;
};

export class PartialOutputStore {
  static readonly NAMESPACE = "orchestrator/partial-outputs";

  constructor(private readonly storage: IStorageService) {}

  set(key: PartialOutputKey, output: StageOutput): void {
    this.store().set(serialiseKey(key), output);
  }

  get(key: PartialOutputKey): StageOutput | undefined {
    return this.store().get(serialiseKey(key)) as StageOutput | undefined;
  }

  delete(key: PartialOutputKey): void {
    this.store().delete(serialiseKey(key));
  }

  clearRun(runId: string): void {
    const data = (this.store().store ?? {}) as Record<string, StageOutput>;
    const prefix = `${runId}#`;
    for (const k of Object.keys(data)) {
      if (k.startsWith(prefix)) this.store().delete(k);
    }
  }

  private store(): Store {
    return this.storage.scoped(PartialOutputStore.NAMESPACE);
  }
}

function serialiseKey(key: PartialOutputKey): string {
  return `${key.runId}#${key.stageId}#${key.branchIndex}`;
}
