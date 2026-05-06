/**
 * Agent Orchestrator — Trace emitter.
 *
 * Single source of truth for trace event distribution:
 *   1. assign a monotonic per-run `seq` (recovered from EventStore so
 *      replays after a crash don't reuse sequence numbers).
 *   2. persist via EventStore (durable, survives crashes).
 *   3. fan out to in-memory subscribers (one stream per run + an
 *      "all-runs" channel that the contract's `subscribeAll` exposes).
 *
 * Subscriptions use a tiny pushable queue rather than `EventEmitter`
 * directly so that consumers can backpressure naturally with
 * `for await`. Closing a subscription releases its queue.
 */

import type {
  TraceEvent,
  TraceEventType,
} from "../../../../shared/features/agent-orchestrator/types";
import type { EventStore } from "../persistence/event-store";

/**
 * Distributive `Omit` so the discriminated union of TraceEvent variants
 * keeps each per-variant payload (`templateId`, `stageId`, `status`, …)
 * after stripping `seq`. A plain `Omit<TraceEvent, "seq">` collapses the
 * union into the intersection of common keys.
 */
type WithoutSeq<T> = T extends unknown ? Omit<T, "seq"> : never;

/** Caller-side trace input (no `seq` — emitter assigns it). */
export type TraceEventInput = WithoutSeq<TraceEvent>;

export type TraceEmitterDeps = {
  eventStore: EventStore;
  /** Override for deterministic tests. */
  clock?: () => number;
};

class Subscription {
  private readonly buffer: TraceEvent[] = [];
  private resolveNext: ((value: IteratorResult<TraceEvent>) => void) | null = null;
  private closed = false;

  push(event: TraceEvent): void {
    if (this.closed) return;
    if (this.resolveNext) {
      const r = this.resolveNext;
      this.resolveNext = null;
      r({ value: event, done: false });
      return;
    }
    this.buffer.push(event);
  }

  close(): void {
    this.closed = true;
    if (this.resolveNext) {
      const r = this.resolveNext;
      this.resolveNext = null;
      r({ value: undefined, done: true });
    }
  }

  iterator(): AsyncIterableIterator<TraceEvent> {
    const sub = this;
    const iter: AsyncIterableIterator<TraceEvent> = {
      [Symbol.asyncIterator]() {
        return iter;
      },
      next: (): Promise<IteratorResult<TraceEvent>> => {
        if (sub.buffer.length > 0) {
          const value = sub.buffer.shift() as TraceEvent;
          return Promise.resolve({ value, done: false });
        }
        if (sub.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve) => {
          sub.resolveNext = resolve;
        });
      },
      return: (): Promise<IteratorResult<TraceEvent>> => {
        sub.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
    return iter;
  }
}

export class TraceEmitter {
  private readonly eventStore: EventStore;
  private readonly clock: () => number;
  private readonly perRunSeq = new Map<string, number>();
  private readonly perRunSubs = new Map<string, Set<Subscription>>();
  private readonly allSubs = new Set<Subscription>();

  constructor(deps: TraceEmitterDeps) {
    this.eventStore = deps.eventStore;
    this.clock = deps.clock ?? Date.now;
  }

  /** Assign seq, persist, and fan out. Returns the persisted event. */
  emit(input: TraceEventInput): TraceEvent {
    const seq = this.nextSeq(input.runId);
    const event = {
      ...input,
      seq,
      timestamp: input.timestamp ?? this.clock(),
    } as TraceEvent;
    this.eventStore.append(input.runId, event);
    this.fanout(event);
    return event;
  }

  /** Stream events for a single run. */
  subscribeRun(runId: string): AsyncIterableIterator<TraceEvent> {
    const sub = new Subscription();
    let bucket = this.perRunSubs.get(runId);
    if (!bucket) {
      bucket = new Set();
      this.perRunSubs.set(runId, bucket);
    }
    bucket.add(sub);
    const iter = sub.iterator();
    const originalReturn = iter.return?.bind(iter);
    iter.return = async () => {
      bucket?.delete(sub);
      if (bucket?.size === 0) this.perRunSubs.delete(runId);
      if (originalReturn) return originalReturn();
      sub.close();
      return { value: undefined, done: true };
    };
    return iter;
  }

  /** Stream events across every run. */
  subscribeAll(): AsyncIterableIterator<TraceEvent> {
    const sub = new Subscription();
    this.allSubs.add(sub);
    const iter = sub.iterator();
    const originalReturn = iter.return?.bind(iter);
    iter.return = async () => {
      this.allSubs.delete(sub);
      if (originalReturn) return originalReturn();
      sub.close();
      return { value: undefined, done: true };
    };
    return iter;
  }

  /** Replay persisted events for a run (used by getRun history). */
  history(runId: string, types?: ReadonlyArray<TraceEventType>): TraceEvent[] {
    const list = this.eventStore.list(runId);
    if (!types || types.length === 0) return list;
    const filter = new Set(types);
    return list.filter((e) => filter.has(e.type));
  }

  /** Drop in-memory subscribers + sequence cursor for a run. */
  closeRun(runId: string): void {
    const subs = this.perRunSubs.get(runId);
    if (subs) {
      for (const s of subs) s.close();
      this.perRunSubs.delete(runId);
    }
    this.perRunSeq.delete(runId);
  }

  private nextSeq(runId: string): number {
    const cached = this.perRunSeq.get(runId);
    const base = cached ?? this.eventStore.lastSeq(runId);
    const next = base + 1;
    this.perRunSeq.set(runId, next);
    return next;
  }

  private fanout(event: TraceEvent): void {
    const bucket = this.perRunSubs.get(event.runId);
    if (bucket) {
      for (const s of bucket) s.push(event);
    }
    for (const s of this.allSubs) s.push(event);
  }
}
