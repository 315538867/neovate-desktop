import type { ArchitectureDoc, FileChange, StageRunRecord } from "../../../../shared/features/agent-orchestrator/schemas";

import type { ChangeTracker } from "../change-tracker";

export interface ConflictResult {
  hasConflicts: boolean;
  conflicts: Array<{
    path: string;
    /** 冲突来源的 instanceId */
    instanceIdA: string;
    instanceIdB: string;
    /** 冲突类型 */
    type: "path-overlap" | "runtime-collision";
    /** 建议的解决方案 */
    suggestedResolution: "auto-merge" | "user-decide" | "abort";
    detail: string;
  }>;
}

/**
 * ConflictDetector — 两阶段冲突检测。
 *
 * Phase 1 (预检): 在 fanOut 展开前，检查 ArchitectureDoc 中不同子实例
 *   分配的模块路径是否有交集。路径交集意味着可能编辑同一文件。
 *
 * Phase 2 (运行时): fanOut 执行完成后，对比 ChangeTracker 记录的实际
 *   文件变更，检测是否有多个子实例修改了同一文件。
 */
export class ConflictDetector {
  private changeTracker: ChangeTracker;

  constructor(changeTracker: ChangeTracker) {
    this.changeTracker = changeTracker;
  }

  /**
   * Phase 1: 预检 — 基于 ArchitectureDoc 的模块路径交集检测。
   *
   * @param architecture ArchDoc 输出
   * @param childInstances 子实例的分配给其的 moduleIndices
   */
  preCheck(
    architecture: ArchitectureDoc,
    childInstances: Array<{ instanceId: string; assignedModules: number[] }>,
  ): ConflictResult {
    const conflicts: ConflictResult["conflicts"] = [];

    // 将 moduleIndex → 文件路径映射
    const modulePaths = architecture.modules.map((m) => m.path);

    // 构建 instanceId → 路径集合
    const instancePaths = new Map<string, Set<string>>();
    for (const child of childInstances) {
      const paths = new Set<string>();
      for (const idx of child.assignedModules) {
        if (idx >= 0 && idx < modulePaths.length) {
          paths.add(modulePaths[idx]);
        }
      }
      instancePaths.set(child.instanceId, paths);
    }

    // 两两比较
    const instanceIds = Array.from(instancePaths.keys());
    for (let i = 0; i < instanceIds.length; i++) {
      for (let j = i + 1; j < instanceIds.length; j++) {
        const pathsA = instancePaths.get(instanceIds[i])!;
        const pathsB = instancePaths.get(instanceIds[j])!;

        for (const path of pathsA) {
          if (pathsB.has(path)) {
            conflicts.push({
              path,
              instanceIdA: instanceIds[i],
              instanceIdB: instanceIds[j],
              type: "path-overlap",
              suggestedResolution: "user-decide",
              detail: `Module path "${path}" assigned to both ${instanceIds[i]} and ${instanceIds[j]}`,
            });
          }
        }
      }
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflicts,
    };
  }

  /**
   * Phase 2: 运行时冲突检测 — 基于 ChangeTracker 的实际文件变更。
   *
   * @param runId 当前 run
   * @param fanOutChildInstanceIds fanOut 子实例 ID 列表
   */
  runtimeCheck(runId: string, fanOutChildInstanceIds: string[]): ConflictResult {
    const conflicts: ConflictResult["conflicts"] = [];

    // 收集每个子实例的文件变更
    const instanceFiles = new Map<string, Set<string>>();
    for (const instanceId of fanOutChildInstanceIds) {
      // ChangeTracker 当前是按 runId 追踪的，这里我们需要按子实例追踪
      // 实际使用中，子实例可能有自己的 sandbox runId
      const changes = this.changeTracker.getChanges(instanceId);
      const files = new Set(changes.map((c) => c.path));
      instanceFiles.set(instanceId, files);
    }

    // 两两比较
    const instanceIds = Array.from(instanceFiles.keys());
    for (let i = 0; i < instanceIds.length; i++) {
      for (let j = i + 1; j < instanceIds.length; j++) {
        const filesA = instanceFiles.get(instanceIds[i])!;
        const filesB = instanceFiles.get(instanceIds[j])!;

        for (const file of filesA) {
          if (filesB.has(file)) {
            conflicts.push({
              path: file,
              instanceIdA: instanceIds[i],
              instanceIdB: instanceIds[j],
              type: "runtime-collision",
              suggestedResolution: "user-decide",
              detail: `File "${file}" modified by both ${instanceIds[i]} and ${instanceIds[j]}`,
            });
          }
        }
      }
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflicts,
    };
  }

  /**
   * 综合检测：先预检再运行时检测。
   */
  detect(
    architecture: ArchitectureDoc,
    childInstances: Array<{ instanceId: string; assignedModules: number[] }>,
    runId: string,
    fanOutChildInstanceIds: string[],
  ): { preCheck: ConflictResult; runtime: ConflictResult; hasAnyConflict: boolean } {
    const preCheck = this.preCheck(architecture, childInstances);
    const runtime = this.runtimeCheck(runId, fanOutChildInstanceIds);

    return {
      preCheck,
      runtime,
      hasAnyConflict: preCheck.hasConflicts || runtime.hasConflicts,
    };
  }
}
