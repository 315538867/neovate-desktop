/**
 * Agent Orchestrator — Retry policy.
 *
 * Pure decision module. Given a classified error and the current
 * attempt count, decide:
 *   • whether to retry at all
 *   • the backoff delay before the next attempt
 *   • whether to bump the provider fallback chain
 *
 * Levels (mirrors `error-classifier.ts`):
 *   L0 — retry up to 3 times, base 250ms backoff, no fallback bump.
 *   L1 — retry up to 3 times, base 1s backoff, bump fallback after 2.
 *   L2 — retry up to 2 times (stage restart), base 2s backoff,
 *        bump fallback after 1.
 *   L3 — never auto-retry.
 *   L4 — never retry (fatal).
 *
 * Backoff is exponential with optional jitter (deterministic in tests
 * by injecting `random`).
 */

import type { ErrorLevel } from "../../../../shared/features/agent-orchestrator/types";
import type { ClassifiedError } from "./error-classifier";

export type RetryDecision = {
  shouldRetry: boolean;
  delayMs: number;
  bumpFallback: boolean;
};

export type RetryPolicyDeps = {
  /** Override for deterministic tests. Should return [0, 1). */
  random?: () => number;
};

export type RetryInput = {
  error: ClassifiedError;
  /** 1-based — the attempt that JUST failed. */
  attempt: number;
};

type LevelConfig = {
  maxAttempts: number;
  baseDelayMs: number;
  fallbackAfter: number; // 0 means never; otherwise bump when attempt >= n
};

const POLICY: Record<ErrorLevel, LevelConfig> = {
  L0: { maxAttempts: 3, baseDelayMs: 250, fallbackAfter: 0 },
  L1: { maxAttempts: 3, baseDelayMs: 1000, fallbackAfter: 2 },
  L2: { maxAttempts: 2, baseDelayMs: 2000, fallbackAfter: 1 },
  L3: { maxAttempts: 0, baseDelayMs: 0, fallbackAfter: 0 },
  L4: { maxAttempts: 0, baseDelayMs: 0, fallbackAfter: 0 },
};

export class RetryPolicy {
  private readonly random: () => number;

  constructor(deps: RetryPolicyDeps = {}) {
    this.random = deps.random ?? Math.random;
  }

  decide(input: RetryInput): RetryDecision {
    const cfg = POLICY[input.error.level];
    if (!input.error.retryable) {
      return { shouldRetry: false, delayMs: 0, bumpFallback: false };
    }
    if (input.attempt >= cfg.maxAttempts) {
      return { shouldRetry: false, delayMs: 0, bumpFallback: false };
    }
    const exponent = Math.max(0, input.attempt - 1);
    const base = cfg.baseDelayMs * Math.pow(2, exponent);
    const jitter = base * 0.3 * this.random();
    const delayMs = Math.round(base + jitter);
    const bumpFallback = cfg.fallbackAfter > 0 && input.attempt >= cfg.fallbackAfter;
    return { shouldRetry: true, delayMs, bumpFallback };
  }
}
