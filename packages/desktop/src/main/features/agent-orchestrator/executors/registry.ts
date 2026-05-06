/**
 * Agent Orchestrator — executor registry.
 *
 * Dispatches `StageNode.executor` (an `ExecutorKind`) to a concrete
 * implementation. Single instance per Orchestrator; constructed in
 * `wireOrchestrator()` (commit 2.5) and supplied to `StageExecutor`
 * via injection.
 */

import type { ExecutorKind } from "../../../../shared/features/agent-orchestrator/types";
import type { Executor } from "./types";

export class ExecutorRegistry {
  private readonly map = new Map<ExecutorKind, Executor>();

  register(executor: Executor): void {
    if (this.map.has(executor.kind)) {
      throw new Error(`[orchestrator] executor "${executor.kind}" already registered`);
    }
    this.map.set(executor.kind, executor);
  }

  resolve(kind: ExecutorKind): Executor {
    const e = this.map.get(kind);
    if (!e) {
      throw new Error(`[orchestrator] no executor registered for "${kind}"`);
    }
    return e;
  }

  has(kind: ExecutorKind): boolean {
    return this.map.has(kind);
  }

  /** Test-only — drop all registrations. */
  _clearForTest(): void {
    this.map.clear();
  }
}
