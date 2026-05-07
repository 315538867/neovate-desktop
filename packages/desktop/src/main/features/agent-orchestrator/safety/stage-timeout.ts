/**
 * Agent Orchestrator — Stage timeout watchdog.
 *
 * Wraps a stage promise with a deadline. If the promise resolves before
 * the deadline, the timer is cancelled and the original value is
 * returned. Otherwise the optional `onTimeout` is invoked (typically to
 * call `AbortController.abort('stage-timeout')`) and the wrapper rejects
 * with `StageTimeoutError`.
 *
 * The wrapper does not race the underlying promise away; the caller is
 * responsible for honouring the abort signal so the work actually stops.
 */

export class StageTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number, message?: string) {
    super(message ?? `Stage exceeded timeout of ${timeoutMs}ms`);
    this.name = "StageTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export type StageTimeoutScheduler = {
  setTimeout: (handler: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

const DEFAULT_SCHEDULER: StageTimeoutScheduler = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type StageTimeoutOptions = {
  onTimeout?: () => void;
  scheduler?: StageTimeoutScheduler;
};

export function withStageTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  options: StageTimeoutOptions = {},
): Promise<T> {
  if (timeoutMs <= 0) return promise;
  const scheduler = options.scheduler ?? DEFAULT_SCHEDULER;

  return new Promise<T>((resolve, reject) => {
    const handle = scheduler.setTimeout(() => {
      try {
        options.onTimeout?.();
      } finally {
        reject(new StageTimeoutError(timeoutMs));
      }
    }, timeoutMs);

    promise.then(
      (value) => {
        scheduler.clearTimeout(handle);
        resolve(value);
      },
      (err) => {
        scheduler.clearTimeout(handle);
        reject(err);
      },
    );
  });
}
