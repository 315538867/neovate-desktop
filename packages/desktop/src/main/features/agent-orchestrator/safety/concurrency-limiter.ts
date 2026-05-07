/**
 * Agent Orchestrator — Concurrency limiter (semaphore).
 *
 * Caps the number of stages running in parallel. The orchestrator's
 * fan-out expander can produce 8+ branches per stage; without an
 * explicit limit, a single run can saturate the user's machine and
 * collide with other concurrent runs.
 *
 * Usage:
 *   const limiter = new ConcurrencyLimiter(3);
 *   const release = await limiter.acquire();
 *   try { await runStage(); } finally { release(); }
 *
 * The implementation is a simple FIFO queue of resolvers. No
 * priority / cancellation knobs — those will be added once a real
 * use-case demands them.
 */

export class ConcurrencyLimiter {
  private readonly limit: number;
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(limit: number) {
    if (!Number.isFinite(limit) || limit < 1) {
      throw new RangeError("ConcurrencyLimiter limit must be >= 1");
    }
    this.limit = Math.floor(limit);
  }

  get inFlight(): number {
    return this.active;
  }

  get pending(): number {
    return this.waiters.length;
  }

  /** Wait for a slot, then return a release function. */
  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active++;
      return this.makeRelease();
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
    this.active++;
    return this.makeRelease();
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      const next = this.waiters.shift();
      next?.();
    };
  }
}
