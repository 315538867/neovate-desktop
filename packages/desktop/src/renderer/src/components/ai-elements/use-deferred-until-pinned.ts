import { useEffect, useRef } from "react";

/** Delay before attempting the deferred commit (matches the prior auto-close timing). */
export const PIN_DEFER_DELAY_MS = 1000;
/** Polling interval while waiting for the user to return to the bottom. */
export const PIN_DEFER_POLL_INTERVAL_MS = 200;
/** Hard cap on how long we will wait for the user before bailing. */
export const PIN_DEFER_POLL_TIMEOUT_MS = 30_000;

/**
 * Schedules a one-shot side-effect (`onCommit`) that should not run while the
 * user is reading scrollback. The flow:
 *
 *   1. Wait `delayMs` after `enabled` becomes true.
 *   2. Check `getIsPinned()` — if true, run `onCommit` immediately.
 *   3. Otherwise poll every `pollIntervalMs` until either pinned (run
 *      `onCommit`) or `timeoutMs` elapses (run `onTimeout` if provided).
 *
 * Used by Reasoning auto-close and AssistantMessage summary auto-collapse to
 * defer programmatic height shrinks while the user is mid-scroll. Both paths
 * previously inlined this logic — extracting it keeps the rules in one place.
 *
 * `onCommit` / `onTimeout` / `getIsPinned` are read through refs so callers
 * can pass inline lambdas without restarting the timer on every render.
 */
export function useDeferredUntilPinned(args: {
  enabled: boolean;
  getIsPinned: () => boolean;
  onCommit: () => void;
  onTimeout?: () => void;
  delayMs: number;
  pollIntervalMs: number;
  timeoutMs: number;
}) {
  const { enabled, delayMs, pollIntervalMs, timeoutMs } = args;

  const getIsPinnedRef = useRef(args.getIsPinned);
  const onCommitRef = useRef(args.onCommit);
  const onTimeoutRef = useRef(args.onTimeout);
  useEffect(() => {
    getIsPinnedRef.current = args.getIsPinned;
    onCommitRef.current = args.onCommit;
    onTimeoutRef.current = args.onTimeout;
  }, [args.getIsPinned, args.onCommit, args.onTimeout]);

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    const commit = () => {
      if (cancelled) return;
      onCommitRef.current();
    };

    const tryCommit = () => {
      if (cancelled) return;
      if (getIsPinnedRef.current()) {
        commit();
        return;
      }
      const pollStart = Date.now();
      interval = setInterval(() => {
        if (cancelled) return;
        if (getIsPinnedRef.current()) {
          if (interval) clearInterval(interval);
          interval = null;
          commit();
          return;
        }
        if (Date.now() - pollStart > timeoutMs) {
          if (interval) clearInterval(interval);
          interval = null;
          if (cancelled) return;
          onTimeoutRef.current?.();
        }
      }, pollIntervalMs);
    };

    timer = setTimeout(tryCommit, delayMs);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (interval) clearInterval(interval);
    };
  }, [enabled, delayMs, pollIntervalMs, timeoutMs]);
}
