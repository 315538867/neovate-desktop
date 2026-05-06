/**
 * Agent Orchestrator — Error log store.
 *
 * Persists `ClassifiedError`s per run/stage so the orchestrator and the
 * dashboard can render error history beyond the live trace. Distinct
 * from `EventStore` because errors carry richer data (code, cause)
 * that does not belong on the wire-typed `TraceEvent.stage.error`.
 *
 * Namespace: `orchestrator/errors`. One bucket per run, value is an
 * array of error rows ordered by insertion.
 */

import type Store from "electron-store";

import type { ErrorLevel } from "../../../../shared/features/agent-orchestrator/types";
import type { IStorageService } from "../../../core/storage-service";

export type StoredErrorRow = {
  id: string;
  runId: string;
  stageId?: string;
  branchIndex?: number;
  level: ErrorLevel;
  code: string;
  message: string;
  cause?: string;
  /** Number of attempts including this one. */
  attempt: number;
  recordedAt: number;
};

export type StoredErrorInput = Omit<StoredErrorRow, "id" | "recordedAt">;

export type ErrorStoreDeps = {
  storage: IStorageService;
  /** Override for deterministic tests. */
  clock?: () => number;
  /** Override for deterministic tests. */
  idFactory?: () => string;
};

let counter = 0;
function defaultId(): string {
  counter++;
  return `err-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export class ErrorStore {
  static readonly NAMESPACE = "orchestrator/errors";

  private readonly storage: IStorageService;
  private readonly clock: () => number;
  private readonly idFactory: () => string;

  constructor(deps: ErrorStoreDeps) {
    this.storage = deps.storage;
    this.clock = deps.clock ?? Date.now;
    this.idFactory = deps.idFactory ?? defaultId;
  }

  record(input: StoredErrorInput): StoredErrorRow {
    const row: StoredErrorRow = {
      ...input,
      id: this.idFactory(),
      recordedAt: this.clock(),
    };
    const list = this.list(input.runId);
    list.push(row);
    this.store().set(input.runId, list);
    return row;
  }

  list(runId: string): StoredErrorRow[] {
    const raw = this.store().get(runId);
    return Array.isArray(raw) ? (raw as StoredErrorRow[]) : [];
  }

  countAttempts(runId: string, stageId: string, branchIndex: number): number {
    let count = 0;
    for (const row of this.list(runId)) {
      if (row.stageId === stageId && row.branchIndex === branchIndex) count++;
    }
    return count;
  }

  clear(runId: string): void {
    this.store().delete(runId);
  }

  private store(): Store {
    return this.storage.scoped(ErrorStore.NAMESPACE);
  }
}
