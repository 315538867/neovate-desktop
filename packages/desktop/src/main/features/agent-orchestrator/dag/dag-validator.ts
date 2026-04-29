import type { PipelineTemplate } from "../../../../shared/features/agent-orchestrator/schemas";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * 校验 Pipeline 模板的 DAG：
 * 1. instanceId 唯一性
 * 2. dependsOn 引用必须存在
 * 3. 环检测（Kahn 算法）
 * 4. 孤岛检测
 */
export function validateDAG(template: PipelineTemplate): ValidationResult {
  const errors: string[] = [];
  const ids = new Set(template.stages.map((s) => s.instanceId));

  // 1. instanceId 唯一性
  if (ids.size !== template.stages.length) {
    errors.push("Duplicate instanceId in stages");
  }

  // 2. dependsOn 引用必须存在
  for (const s of template.stages) {
    for (const dep of s.dependsOn) {
      if (!ids.has(dep)) {
        errors.push(`Stage ${s.instanceId} depends on missing ${dep}`);
      }
    }
  }

  // 3. 环检测（Kahn 算法）
  if (hasCycle(template.stages)) {
    errors.push("Cycle detected in DAG");
  }

  // 4. 孤岛检测：除了根 stage（dependsOn 为空），每个 stage 必须可达
  const reachable = computeReachable(template.stages);
  for (const s of template.stages) {
    if (!reachable.has(s.instanceId)) {
      errors.push(`Stage ${s.instanceId} unreachable from any root`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function hasCycle(stages: PipelineTemplate["stages"]): boolean {
  const ids = new Set<string>(stages.map((s) => s.instanceId));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of ids) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const s of stages) {
    for (const dep of s.dependsOn) {
      adjacency.get(dep)?.push(s.instanceId);
      inDegree.set(s.instanceId, (inDegree.get(s.instanceId) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    visited++;
    for (const neighbor of adjacency.get(current) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return visited !== ids.size;
}

function computeReachable(stages: PipelineTemplate["stages"]): Set<string> {
  const adjacency = new Map<string, string[]>();

  for (const s of stages) {
    const neighbors: string[] = [];
    for (const other of stages) {
      if (other.dependsOn.includes(s.instanceId)) {
        neighbors.push(other.instanceId);
      }
    }
    adjacency.set(s.instanceId, neighbors);
  }

  // roots: stages with no dependencies
  const roots = stages.filter((s) => s.dependsOn.length === 0).map((s) => s.instanceId);

  const visited = new Set<string>();
  const queue = [...roots];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }

  return visited;
}
