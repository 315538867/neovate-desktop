/**
 * Agent Orchestrator — Checkpoint manager.
 *
 * Records executor-defined snapshots used to resume a stage mid-flight.
 * Storage is one bucket per `runId` (array of `Checkpoint` rows ordered
 * by insertion). `getLatest(runId, stageId, branchIndex)` returns the
 * most recently persisted snapshot for a (stage, branch) pair.
 *
 * Determinism notes:
 *   • `clock` and `idFactory` are injectable to keep tests stable.
 *   • Checkpoint payload is stored as-is — callers are responsible for
 *     keeping it JSON-serialisable.
 */

import type Store from "electron-store";

import { randomUUID } from "node:crypto";

import type { Checkpoint } from "../../../../shared/features/agent-orchestrator/types";
import type { IStorageService } from "../../../core/storage-service";

export type CheckpointInput = {
  runId: string;
  stageId: string;
  branchIndex: number;
  payload: unknown;
};

export type CheckpointManagerDeps = {
  storage: IStorageService;
  /** Override for deterministic tests. */
  clock?: () => number;
  /** Override for deterministic tests. */
  idFactory?: () => string;
};

export class CheckpointManager {
  static readonly NAMESPACE = "orchestrator/checkpoints";

  private readonly storage: IStorageService;
  private readonly clock: () => number;
  private readonly idFactory: () => string;

  constructor(deps: CheckpointManagerDeps) {
    this.storage = deps.storage;
    this.clock = deps.clock ?? Date.now;
    this.idFactory = deps.idFactory ?? randomUUID;
  }

  record(input: CheckpointInput): Checkpoint {
    const checkpoint: Checkpoint = {
      id: this.idFactory(),
      runId: input.runId,
      stageId: input.stageId,
      branchIndex: input.branchIndex,
      persistedAt: this.clock(),
      payload: input.payload,
    };
    const list = this.list(input.runId);
    list.push(checkpoint);
    this.store().set(input.runId, list);
    return checkpoint;
  }

  list(runId: string): Checkpoint[] {
    const raw = this.store().get(runId);
    return Array.isArray(raw) ? (raw as Checkpoint[]) : [];
  }

  /** Most recent snapshot for a (stage, branch) — `undefined` if none. */
  getLatest(runId: string, stageId: string, branchIndex: number): Checkpoint | undefined {
    let best: Checkpoint | undefined;
    for (const cp of this.list(runId)) {
      if (cp.stageId !== stageId) continue;
      if (cp.branchIndex !== branchIndex) continue;
      if (!best || cp.persistedAt > best.persistedAt) best = cp;
    }
    return best;
  }

  clear(runId: string): void {
    this.store().delete(runId);
  }

  private store(): Store {
    return this.storage.scoped(CheckpointManager.NAMESPACE);
  }
}
