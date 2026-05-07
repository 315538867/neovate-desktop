/**
 * Agent Orchestrator — ChangeTracker.
 *
 * Records the set of files an executor reports as touched during a
 * stage execution. The orchestrator trusts this tracker — *not* the
 * model's self-report — so that downstream stages (reviewer / validator)
 * see the actual diff surface.
 *
 * Implementation is intentionally minimal: an in-memory `Map` keyed by
 * `${runId}#${stageId}#${branchIndex}` storing a deduplicated set of
 * paths plus the action recorded last for each path. The file-system
 * reconciliation step (post-execution) lives in the executor layer.
 */

export type ChangeAction = "read" | "write" | "delete";

export type ChangeEntry = {
  path: string;
  action: ChangeAction;
  at: number;
};

export type ChangeKey = {
  runId: string;
  stageId: string;
  branchIndex?: number;
};

function keyOf(k: ChangeKey): string {
  return `${k.runId}#${k.stageId}#${k.branchIndex ?? 0}`;
}

export class ChangeTracker {
  private readonly buckets = new Map<string, Map<string, ChangeEntry>>();
  private readonly clock: () => number;

  constructor(opts: { clock?: () => number } = {}) {
    this.clock = opts.clock ?? Date.now;
  }

  record(key: ChangeKey, path: string, action: ChangeAction): void {
    const id = keyOf(key);
    let bucket = this.buckets.get(id);
    if (!bucket) {
      bucket = new Map();
      this.buckets.set(id, bucket);
    }
    bucket.set(path, { path, action, at: this.clock() });
  }

  /** All entries for a given branch (deduped by path). */
  list(key: ChangeKey): ChangeEntry[] {
    const bucket = this.buckets.get(keyOf(key));
    if (!bucket) return [];
    return Array.from(bucket.values()).sort((a, b) => a.at - b.at);
  }

  /** Return file paths that were write/delete (the actual change surface). */
  changedFiles(key: ChangeKey): string[] {
    return this.list(key)
      .filter((e) => e.action === "write" || e.action === "delete")
      .map((e) => e.path);
  }

  clear(key: ChangeKey): void {
    this.buckets.delete(keyOf(key));
  }

  /** Drop every record for a runId — called on run completion. */
  clearRun(runId: string): void {
    const prefix = `${runId}#`;
    for (const k of Array.from(this.buckets.keys())) {
      if (k.startsWith(prefix)) this.buckets.delete(k);
    }
  }
}
