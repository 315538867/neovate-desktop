/**
 * Agent Orchestrator — Heartbeat monitor.
 *
 * Long-running stage executors are required to call `tick(stageId)` on a
 * regular cadence. If a stage fails to tick within `staleAfterMs`, the
 * monitor invokes `onStale(stageId, lastTickMs)` so the orchestrator
 * can abort the stage and surface a `stage.error` event with level
 * `L2` (transient executor stall).
 *
 * The monitor is timer-driven (single `setInterval`) but accepts an
 * injectable scheduler so tests can drive it deterministically.
 */

export type HeartbeatStaleHandler = (stageId: string, lastTickMs: number) => void;

export type HeartbeatScheduler = {
  setInterval: (handler: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

export type HeartbeatMonitorDeps = {
  /** How long a stage may stay silent before it is considered stale. */
  staleAfterMs: number;
  /** Called when a stage misses the deadline. */
  onStale: HeartbeatStaleHandler;
  /** Override for deterministic tests. */
  clock?: () => number;
  /** Override for deterministic tests; defaults to global timers. */
  scheduler?: HeartbeatScheduler;
  /**
   * Sweep cadence — how often the monitor wakes to compare last-tick
   * timestamps against `staleAfterMs`. Defaults to half of `staleAfterMs`.
   */
  sweepIntervalMs?: number;
};

const DEFAULT_SCHEDULER: HeartbeatScheduler = {
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export class HeartbeatMonitor {
  private readonly staleAfterMs: number;
  private readonly onStale: HeartbeatStaleHandler;
  private readonly clock: () => number;
  private readonly scheduler: HeartbeatScheduler;
  private readonly sweepIntervalMs: number;
  private readonly lastTick = new Map<string, number>();
  private readonly stalePending = new Set<string>();
  private handle: unknown = undefined;

  constructor(deps: HeartbeatMonitorDeps) {
    if (deps.staleAfterMs <= 0) throw new RangeError("staleAfterMs must be > 0");
    this.staleAfterMs = deps.staleAfterMs;
    this.onStale = deps.onStale;
    this.clock = deps.clock ?? Date.now;
    this.scheduler = deps.scheduler ?? DEFAULT_SCHEDULER;
    this.sweepIntervalMs = deps.sweepIntervalMs ?? Math.max(50, Math.floor(deps.staleAfterMs / 2));
  }

  start(): void {
    if (this.handle !== undefined) return;
    this.handle = this.scheduler.setInterval(() => this.sweep(), this.sweepIntervalMs);
  }

  stop(): void {
    if (this.handle === undefined) return;
    this.scheduler.clearInterval(this.handle);
    this.handle = undefined;
  }

  /** Record a heartbeat for `stageId`. */
  tick(stageId: string): void {
    this.lastTick.set(stageId, this.clock());
    this.stalePending.delete(stageId);
  }

  /** Stop tracking a stage (e.g. when it completes). */
  release(stageId: string): void {
    this.lastTick.delete(stageId);
    this.stalePending.delete(stageId);
  }

  /** Force one immediate sweep — used by tests and the scheduler tick. */
  sweep(): void {
    const now = this.clock();
    for (const [stageId, last] of this.lastTick) {
      if (now - last < this.staleAfterMs) continue;
      if (this.stalePending.has(stageId)) continue;
      this.stalePending.add(stageId);
      this.onStale(stageId, last);
    }
  }
}
