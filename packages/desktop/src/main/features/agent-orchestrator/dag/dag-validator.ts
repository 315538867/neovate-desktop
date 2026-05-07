/**
 * Agent Orchestrator — DAG validator.
 *
 * Validates a `PipelineTemplate.stages` array as a directed-acyclic
 * graph and returns a topologically ordered stage id list. The
 * orchestrator's tick loop then walks this order and dispatches stages
 * whose dependencies have all completed successfully.
 *
 * Errors discovered up-front prevent half-run states from ever entering
 * persistence — `validateDag` MUST be called by `Orchestrator.startRun`
 * before any execution begins.
 */

import type {
  PipelineTemplate,
  StageNode,
} from "../../../../shared/features/agent-orchestrator/types";

export type DagValidationOk = {
  ok: true;
  /** Stage ids in topological order; safe to walk for dispatch. */
  order: string[];
  /** Adjacency map: dependency → list of stages waiting on it. */
  dependents: ReadonlyMap<string, readonly string[]>;
};

export type DagValidationError = {
  ok: false;
  reason:
    | "duplicate-stage-id"
    | "missing-dependency"
    | "cycle"
    | "self-dependency"
    | "empty-stages";
  /** Stage ids implicated in the failure (for surface-able errors). */
  offenders: string[];
  message: string;
};

export type DagValidationResult = DagValidationOk | DagValidationError;

/**
 * Validate a pipeline. Pure function — no logging, no side effects, no
 * I/O. Pull the result and surface failures via `error-classifier` at
 * the call site.
 */
export function validateDag(template: PipelineTemplate): DagValidationResult {
  const stages = template.stages;
  if (!stages || stages.length === 0) {
    return {
      ok: false,
      reason: "empty-stages",
      offenders: [],
      message: "Pipeline must declare at least one stage",
    };
  }

  // 1. Duplicate id check.
  const ids = new Set<string>();
  const dupes: string[] = [];
  for (const stage of stages) {
    if (ids.has(stage.id)) dupes.push(stage.id);
    ids.add(stage.id);
  }
  if (dupes.length > 0) {
    return {
      ok: false,
      reason: "duplicate-stage-id",
      offenders: dupes,
      message: `Duplicate stage ids: ${dupes.join(", ")}`,
    };
  }

  // 2. Missing dependency / self-dependency check.
  const missing: string[] = [];
  const selfDep: string[] = [];
  for (const stage of stages) {
    for (const dep of stage.dependsOn) {
      if (dep === stage.id) selfDep.push(stage.id);
      else if (!ids.has(dep)) missing.push(`${stage.id}→${dep}`);
    }
  }
  if (selfDep.length > 0) {
    return {
      ok: false,
      reason: "self-dependency",
      offenders: selfDep,
      message: `Stages cannot depend on themselves: ${selfDep.join(", ")}`,
    };
  }
  if (missing.length > 0) {
    return {
      ok: false,
      reason: "missing-dependency",
      offenders: missing,
      message: `Missing dependency edges: ${missing.join(", ")}`,
    };
  }

  // 3. Topological sort (Kahn's algorithm).
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const stage of stages) {
    indegree.set(stage.id, stage.dependsOn.length);
    dependents.set(stage.id, []);
  }
  for (const stage of stages) {
    for (const dep of stage.dependsOn) {
      dependents.get(dep)!.push(stage.id);
    }
  }

  const order: string[] = [];
  const ready: string[] = [];
  for (const [id, n] of indegree) if (n === 0) ready.push(id);
  // Stable order: sort by template-declared position so determinism doesn't
  // depend on Map iteration order (V8-specific in practice but documented
  // as insertion-order; relying on declared order is clearer).
  const pos = new Map(stages.map((s, i) => [s.id, i] as const));
  ready.sort((a, b) => pos.get(a)! - pos.get(b)!);

  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    const next = dependents.get(id)!;
    for (const child of next) {
      const newIn = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, newIn);
      if (newIn === 0) {
        // keep template order for determinism
        const insertAt = ready.findIndex((r) => pos.get(r)! > pos.get(child)!);
        if (insertAt === -1) ready.push(child);
        else ready.splice(insertAt, 0, child);
      }
    }
  }

  if (order.length !== stages.length) {
    const remaining = [...indegree.entries()].filter(([, n]) => n > 0).map(([id]) => id);
    return {
      ok: false,
      reason: "cycle",
      offenders: remaining,
      message: `Cycle detected involving: ${remaining.join(", ")}`,
    };
  }

  return { ok: true, order, dependents };
}

/**
 * Convenience: throw on validation failure. Use only at boot/startRun
 * boundaries where a thrown error is the natural surface.
 */
export function validateDagOrThrow(template: PipelineTemplate): DagValidationOk {
  const r = validateDag(template);
  if (!r.ok) throw new Error(`[orchestrator] DAG invalid (${r.reason}): ${r.message}`);
  return r;
}

/**
 * Direct stage lookup helper. The validator does not store `StageNode`
 * objects — callers map on their own to keep this module dependency-free.
 */
export function buildStageMap(stages: StageNode[]): ReadonlyMap<string, StageNode> {
  return new Map(stages.map((s) => [s.id, s] as const));
}
