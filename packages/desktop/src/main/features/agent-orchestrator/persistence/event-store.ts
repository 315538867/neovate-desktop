/**
 * Agent Orchestrator — Trace event log.
 *
 * Append-only persistence of `TraceEvent` per run. Wave 3.2 commit 2.4
 * wires `TraceEmitter` to call `append()` on every emit; the contract's
 * `subscribeRun` / `subscribeAll` consume the in-memory channel — this
 * store backs `getRun()` history rendering and post-mortem replays.
 */

import type Store from "electron-store";

import type { TraceEvent } from "../../../../shared/features/agent-orchestrator/types";
import type { IStorageService } from "../../../core/storage-service";

export class EventStore {
  static readonly NAMESPACE = "orchestrator/events";

  constructor(private readonly storage: IStorageService) {}

  append(runId: string, event: TraceEvent): void {
    const list = this.list(runId);
    list.push(event);
    this.store().set(runId, list);
  }

  appendBatch(runId: string, events: readonly TraceEvent[]): void {
    if (events.length === 0) return;
    const list = this.list(runId);
    list.push(...events);
    this.store().set(runId, list);
  }

  list(runId: string): TraceEvent[] {
    const raw = this.store().get(runId);
    return Array.isArray(raw) ? (raw as TraceEvent[]) : [];
  }

  /** Highest persisted `seq` for a run (0 when no events). */
  lastSeq(runId: string): number {
    const list = this.list(runId);
    let max = 0;
    for (const ev of list) {
      if (ev.seq > max) max = ev.seq;
    }
    return max;
  }

  clear(runId: string): void {
    this.store().delete(runId);
  }

  private store(): Store {
    return this.storage.scoped(EventStore.NAMESPACE);
  }
}
