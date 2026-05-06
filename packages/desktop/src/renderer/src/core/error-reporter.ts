/**
 * Error reporter — single funnel for "we tried, it failed, the user should know".
 *
 * Replaces the long-tail of `.catch(() => {})` calls in renderer code that
 * silently dropped errors from oRPC operations. The default sink is a no-op
 * (so the module can be imported in tests without a side-effect on a missing
 * UI). `core/app.tsx` installs a sink at startup that maps reported errors
 * onto the global toast manager.
 *
 * Use this for: best-effort writes that may legitimately fail (network, IPC),
 * but where a silent failure leaves the UI lying to the user.
 *
 * Do NOT use this for:
 *   - Telemetry / analytics (failures should remain silent)
 *   - Cleanup operations where the error genuinely doesn't matter
 *   - Errors caught by component-level error boundaries
 */

import debug from "debug";

const log = debug("neovate:error-reporter");

export type ErrorContext = Record<string, unknown>;

export type ErrorSink = (err: Error, ctx?: ErrorContext) => void;

let sink: ErrorSink = (err, ctx) => {
  log("(no sink) %s %o", err.message, ctx ?? {});
};

/**
 * Install the renderer-wide error sink. Called once at startup from
 * `core/app.tsx`. Tests may override to capture reports.
 */
export function setErrorSink(s: ErrorSink): void {
  sink = s;
}

/**
 * Reset the sink to the default (silent / log-only). For tests.
 */
export function resetErrorSink(): void {
  sink = (err, ctx) => {
    log("(no sink) %s %o", err.message, ctx ?? {});
  };
}

/**
 * Report an arbitrary thrown value to the active sink. Strings, plain objects
 * and Errors are all accepted — the sink always receives a real `Error`.
 */
export function reportError(err: unknown, ctx?: ErrorContext): void {
  const e = err instanceof Error ? err : new Error(String(err));
  try {
    sink(e, ctx);
  } catch (sinkErr) {
    log("sink threw: %s", (sinkErr as Error).message);
  }
}

/**
 * Wrap a promise so any rejection is reported and the resolved value
 * (or `undefined` on failure) is returned. The promise itself is no longer
 * reject-able from the caller's perspective.
 *
 * Use this to replace `.catch(() => {})` patterns where you want the same
 * "fire-and-forget" semantics but ALSO want the user notified on failure:
 *
 *     // Before
 *     client.foo.bar(input).catch(() => {});
 *
 *     // After
 *     void withReport(client.foo.bar(input), { op: "foo.bar" });
 */
export async function withReport<T>(
  promise: Promise<T>,
  ctx?: ErrorContext,
): Promise<T | undefined> {
  try {
    return await promise;
  } catch (err) {
    reportError(err, ctx);
    return undefined;
  }
}
