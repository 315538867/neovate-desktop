/**
 * Agent Orchestrator — executor runtime types.
 *
 * Re-exports the shared `Executor` interface alongside main-only
 * runtime helpers (abort controllers, simple progress collectors).
 * Renderer code MUST NOT import from this file — only the cross-process
 * interface contract in `shared/features/agent-orchestrator/executor-types`.
 */

export type {
  Executor,
  ExecutorAbortSignal,
  ExecutorContext,
  ExecutorInput,
  ExecutorProgress,
  ExecutorPromptVariables,
  ExecutorResult,
} from "../../../../shared/features/agent-orchestrator/executor-types";

import type {
  ExecutorAbortSignal,
  ExecutorProgress,
} from "../../../../shared/features/agent-orchestrator/executor-types";

/**
 * Adapter wrapping a standard `AbortController.signal` so it satisfies
 * `ExecutorAbortSignal`. The controller-side `abort(reason)` flows
 * through to listeners without round-tripping through `dispatchEvent`.
 */
export class OrchestratorAbortController {
  readonly controller = new AbortController();
  private listeners = new Set<() => void>();
  private _reason?: string;

  abort(reason?: string): void {
    if (this.controller.signal.aborted) return;
    this._reason = reason;
    this.controller.abort(reason);
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        // Ignore listener errors — abort fans out best-effort.
      }
    }
  }

  /** Adapter view satisfying `ExecutorAbortSignal`. */
  get signal(): ExecutorAbortSignal {
    // Arrow functions capture `this` lexically so the inner properties
    // resolve back to the OrchestratorAbortController instance.
    const view = {
      addEventListener: (type: "abort", listener: () => void): void => {
        if (type !== "abort") return;
        this.listeners.add(listener);
        if (this.controller.signal.aborted) {
          // Already aborted — fire synchronously so the executor exits.
          try {
            listener();
          } catch {
            // best-effort
          }
        }
      },
      removeEventListener: (type: "abort", listener: () => void): void => {
        if (type !== "abort") return;
        this.listeners.delete(listener);
      },
    };
    Object.defineProperties(view, {
      aborted: {
        get: () => this.controller.signal.aborted,
        enumerable: true,
      },
      reason: {
        get: () => this._reason,
        enumerable: true,
      },
    });
    return view as unknown as ExecutorAbortSignal;
  }
}

/**
 * Lightweight in-memory progress collector — fed to executors in
 * tests when no trace emitter is wired.
 */
export class CollectingProgressSink {
  readonly items: ExecutorProgress[] = [];

  emitProgress = (item: ExecutorProgress): void => {
    this.items.push(item);
  };

  getInputTokens(): number {
    let total = 0;
    for (const it of this.items) {
      if (it.kind === "tokens" && typeof it.deltaInput === "number") total += it.deltaInput;
    }
    return total;
  }

  getOutputTokens(): number {
    let total = 0;
    for (const it of this.items) {
      if (it.kind === "tokens" && typeof it.deltaOutput === "number") total += it.deltaOutput;
    }
    return total;
  }
}
