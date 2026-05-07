/**
 * Agent Orchestrator — Error classifier.
 *
 * Maps a caught `unknown` into a structured `ClassifiedError` with a
 * severity ladder used by RetryPolicy and surfaced in TraceEvent
 * (`stage.error.level`):
 *
 *   L0 — transient executor noise (rate-limit, brief network blip).
 *        Retry immediately or with very short backoff.
 *   L1 — provider 5xx / network outages. Retry with exponential
 *        backoff; switch fallback model after N attempts.
 *   L2 — executor stall / stage timeout / heartbeat lapse. Restart
 *        the stage; do not auto-retry the whole run.
 *   L3 — stage-level fatal: validation rejected output, stage
 *        produced invalid payload, sandbox health failed. Surface to
 *        the user; auto-retry only if explicitly enabled.
 *   L4 — run-level fatal: missing template, malformed DAG, budget
 *        envelope error. No retry.
 *
 * Heuristics are conservative: anything we don't recognise lands at
 * L3 so the user notices instead of the orchestrator silently looping.
 */

import type { ErrorLevel } from "../../../../shared/features/agent-orchestrator/types";

export type ClassifiedError = {
  level: ErrorLevel;
  message: string;
  /** Stable identifier (eg. "rate-limit", "stage-timeout") for analytics. */
  code: string;
  cause?: string;
  retryable: boolean;
};

const RATE_LIMIT_PATTERNS = [/rate[- _]?limit/i, /429/i, /\btoo many requests\b/i];
const TRANSIENT_NETWORK_PATTERNS = [
  /ECONN(?:RESET|REFUSED|ABORTED)/,
  /ETIMEDOUT/,
  /\bnetwork\b/i,
  /\bsocket hang up\b/i,
];
const SERVER_ERROR_PATTERNS = [/\b5\d\d\b/, /upstream/i, /bad gateway/i, /service unavailable/i];

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function causeOf(err: unknown): string | undefined {
  if (err instanceof Error && err.stack) return err.stack;
  return undefined;
}

export function classifyError(err: unknown): ClassifiedError {
  const message = messageOf(err);
  const cause = causeOf(err);

  if (err instanceof Error && err.name === "StageTimeoutError") {
    return { level: "L2", code: "stage-timeout", message, cause, retryable: true };
  }

  // Explicit budget abort — never auto-retry (caller decides).
  if (/budget exceeded|abort.*budget/i.test(message)) {
    return { level: "L4", code: "budget-exceeded", message, cause, retryable: false };
  }

  if (RATE_LIMIT_PATTERNS.some((p) => p.test(message))) {
    return { level: "L0", code: "rate-limit", message, cause, retryable: true };
  }

  if (TRANSIENT_NETWORK_PATTERNS.some((p) => p.test(message))) {
    return { level: "L1", code: "network-transient", message, cause, retryable: true };
  }

  if (SERVER_ERROR_PATTERNS.some((p) => p.test(message))) {
    return { level: "L1", code: "provider-5xx", message, cause, retryable: true };
  }

  if (/heartbeat|stale/i.test(message)) {
    return { level: "L2", code: "heartbeat-stale", message, cause, retryable: true };
  }

  if (/template (not found|missing)|invalid (template|dag|stage)/i.test(message)) {
    return { level: "L4", code: "config-error", message, cause, retryable: false };
  }

  if (/validation|schema|invalid output/i.test(message)) {
    return { level: "L3", code: "validation-failed", message, cause, retryable: false };
  }

  return { level: "L3", code: "unknown", message, cause, retryable: false };
}
