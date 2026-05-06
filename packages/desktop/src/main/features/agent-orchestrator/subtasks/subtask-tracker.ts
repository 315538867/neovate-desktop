/**
 * Agent Orchestrator — SubtaskTracker.
 *
 * Tracks executor-spawned subtasks so the orchestrator can correlate
 * nested LLM calls back to a parent stage execution. The current
 * implementation is intentionally minimal — a parent → children map
 * — so the API can grow when fan-out / Claude Agent SDK sub-agents
 * surface richer metadata (commit 2.5).
 */

export type SubtaskRecord = {
  id: string;
  parentRunId: string;
  parentStageId: string;
  branchIndex: number;
  label?: string;
  startedAt: number;
  completedAt?: number;
  outcome?: "succeeded" | "failed" | "cancelled";
};

export type SubtaskKey = {
  runId: string;
  stageId: string;
  branchIndex?: number;
};

export class SubtaskTracker {
  private readonly subtasks = new Map<string, SubtaskRecord>();
  private readonly clock: () => number;
  private nextId = 1;

  constructor(opts: { clock?: () => number; idFactory?: () => string } = {}) {
    this.clock = opts.clock ?? Date.now;
    if (opts.idFactory) this.nextId = 0; // sentinel — handled below
    this.makeId = opts.idFactory ?? this.makeId.bind(this);
  }

  private makeId(): string {
    return `st-${this.nextId++}`;
  }

  start(key: SubtaskKey, label?: string): SubtaskRecord {
    const id = this.makeId();
    const rec: SubtaskRecord = {
      id,
      parentRunId: key.runId,
      parentStageId: key.stageId,
      branchIndex: key.branchIndex ?? 0,
      label,
      startedAt: this.clock(),
    };
    this.subtasks.set(id, rec);
    return rec;
  }

  complete(id: string, outcome: NonNullable<SubtaskRecord["outcome"]>): void {
    const rec = this.subtasks.get(id);
    if (!rec) return;
    rec.outcome = outcome;
    rec.completedAt = this.clock();
  }

  list(key: SubtaskKey): SubtaskRecord[] {
    const branchIndex = key.branchIndex ?? 0;
    return Array.from(this.subtasks.values())
      .filter(
        (r) =>
          r.parentRunId === key.runId &&
          r.parentStageId === key.stageId &&
          r.branchIndex === branchIndex,
      )
      .sort((a, b) => a.startedAt - b.startedAt);
  }

  clearRun(runId: string): void {
    for (const [id, rec] of this.subtasks) {
      if (rec.parentRunId === runId) this.subtasks.delete(id);
    }
  }
}
