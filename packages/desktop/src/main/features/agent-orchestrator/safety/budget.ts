/**
 * Agent Orchestrator — Budget tracker.
 *
 * Accumulates token / duration / cost / stage usage against the run's
 * `Budget` envelope. The orchestrator drives the tracker via four
 * imperative `consume*` methods; whenever a cap is breached the
 * `onExceed(dimension, usage)` callback fires (at most once per
 * dimension within a tracker instance) and `aborted` flips to `true`.
 *
 * The class is deliberately framework-free — it does not own an
 * `AbortController`. The caller hooks `onExceed` to whatever cancel
 * mechanism it wants (Wave 3.2 commit 2.5 wires it to the run's
 * AbortController).
 *
 * Integration with `request-tracker.ts`: the orchestrator subscribes to
 * `eventPublisher.publish(sessionId, summary)` (request-tracker emits
 * `RequestSummary` on every request `phase: "end"`) and forwards
 * `summary.usage.{inputTokens, outputTokens, cacheReadInputTokens?,
 * cacheCreationInputTokens?}` to `consumeTokens`.
 */

import type { Budget, BudgetUsage } from "../../../../shared/features/agent-orchestrator/types";

export type BudgetDimension = "tokens" | "duration" | "cost" | "stages";

export type BudgetExceedHandler = (dimension: BudgetDimension, usage: BudgetUsage) => void;

export type BudgetTrackerDeps = {
  budget?: Budget;
  initialUsage?: Partial<BudgetUsage>;
  onExceed?: BudgetExceedHandler;
};

const ZERO_USAGE: BudgetUsage = {
  usedTokens: 0,
  usedDurationMs: 0,
  usedCostUsd: 0,
  completedStages: 0,
};

export class BudgetTracker {
  private readonly budget?: Budget;
  private readonly onExceed?: BudgetExceedHandler;
  private readonly fired = new Set<BudgetDimension>();
  private usage: BudgetUsage;
  private _aborted = false;

  constructor(deps: BudgetTrackerDeps = {}) {
    this.budget = deps.budget;
    this.onExceed = deps.onExceed;
    this.usage = { ...ZERO_USAGE, ...deps.initialUsage };
  }

  get aborted(): boolean {
    return this._aborted;
  }

  snapshot(): BudgetUsage {
    return { ...this.usage };
  }

  consumeTokens(delta: number): BudgetUsage {
    if (delta < 0) throw new RangeError("token delta must be non-negative");
    this.usage = { ...this.usage, usedTokens: this.usage.usedTokens + delta };
    this.checkCap("tokens", this.usage.usedTokens, this.budget?.maxTokens);
    return this.snapshot();
  }

  consumeDuration(deltaMs: number): BudgetUsage {
    if (deltaMs < 0) throw new RangeError("duration delta must be non-negative");
    this.usage = {
      ...this.usage,
      usedDurationMs: this.usage.usedDurationMs + deltaMs,
    };
    this.checkCap("duration", this.usage.usedDurationMs, this.budget?.maxDurationMs);
    return this.snapshot();
  }

  consumeCost(deltaUsd: number): BudgetUsage {
    if (deltaUsd < 0) throw new RangeError("cost delta must be non-negative");
    this.usage = { ...this.usage, usedCostUsd: this.usage.usedCostUsd + deltaUsd };
    this.checkCap("cost", this.usage.usedCostUsd, this.budget?.maxCostUsd);
    return this.snapshot();
  }

  incrementStages(delta = 1): BudgetUsage {
    if (delta < 0) throw new RangeError("stage delta must be non-negative");
    this.usage = {
      ...this.usage,
      completedStages: this.usage.completedStages + delta,
    };
    this.checkCap("stages", this.usage.completedStages, this.budget?.maxStages);
    return this.snapshot();
  }

  /** Re-evaluate caps without mutating usage — useful after a snapshot import. */
  reevaluate(): void {
    this.checkCap("tokens", this.usage.usedTokens, this.budget?.maxTokens);
    this.checkCap("duration", this.usage.usedDurationMs, this.budget?.maxDurationMs);
    this.checkCap("cost", this.usage.usedCostUsd, this.budget?.maxCostUsd);
    this.checkCap("stages", this.usage.completedStages, this.budget?.maxStages);
  }

  private checkCap(dimension: BudgetDimension, used: number, cap: number | undefined): void {
    if (cap === undefined) return;
    if (used < cap) return;
    if (this.fired.has(dimension)) return;
    this.fired.add(dimension);
    this._aborted = true;
    this.onExceed?.(dimension, this.snapshot());
  }
}
