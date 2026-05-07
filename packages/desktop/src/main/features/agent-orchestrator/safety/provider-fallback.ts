/**
 * Agent Orchestrator — Provider / model fallback chain.
 *
 * Stage executors carry a single primary model id but a stage may
 * declare a fallback chain: e.g.
 *
 *   ["anthropic/claude-sonnet-4-6", "anthropic/claude-haiku-4-5"]
 *
 * When the primary fails with a transient error (rate limit / 5xx /
 * provider-down), the orchestrator can call `next()` to step through
 * the chain. Failures recorded via `recordFailure(reason)` are
 * exposed for trace events; the chain itself is immutable.
 *
 * Cost / latency policy lives in the caller — this class is just the
 * cursor.
 */

export type FailureRecord = {
  model: string;
  reason: string;
  at: number;
};

export type ProviderFallbackDeps = {
  models: ReadonlyArray<string>;
  /** Override for deterministic tests. */
  clock?: () => number;
};

export class ProviderFallback {
  private readonly models: ReadonlyArray<string>;
  private readonly clock: () => number;
  private cursor = 0;
  private readonly failures: FailureRecord[] = [];

  constructor(deps: ProviderFallbackDeps) {
    if (deps.models.length === 0) {
      throw new RangeError("ProviderFallback requires at least one model");
    }
    this.models = [...deps.models];
    this.clock = deps.clock ?? Date.now;
  }

  current(): string {
    const model = this.models[this.cursor];
    if (model === undefined) {
      throw new Error("Provider fallback chain exhausted");
    }
    return model;
  }

  hasNext(): boolean {
    return this.cursor + 1 < this.models.length;
  }

  /** Move to the next model in the chain; returns the new current model. */
  next(): string {
    if (!this.hasNext()) {
      throw new Error("Provider fallback chain exhausted");
    }
    this.cursor++;
    return this.current();
  }

  /** Record why the current model failed (for tracing / analytics). */
  recordFailure(reason: string): FailureRecord {
    const record: FailureRecord = {
      model: this.current(),
      reason,
      at: this.clock(),
    };
    this.failures.push(record);
    return record;
  }

  /** Snapshot of failures so far (caller-owned copy). */
  history(): FailureRecord[] {
    return [...this.failures];
  }

  reset(): void {
    this.cursor = 0;
    this.failures.length = 0;
  }
}
