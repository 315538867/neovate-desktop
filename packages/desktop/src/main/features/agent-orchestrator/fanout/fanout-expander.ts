import type {
  ArchitectureDoc,
  PipelineRun,
  PipelineTemplate,
  StageRunRecord,
  StageRunStatus,
} from "../../../../shared/features/agent-orchestrator/schemas";

import { SafeConditionEvaluator } from "./safe-condition-evaluator";

export interface FanOutSubInstance {
  instanceId: string;
  label: string;
  assignedModules: number[];
  sandboxPath?: string;
}

export interface FanOutExpansion {
  /** 是否满足 fanOut 条件 */
  shouldExpand: boolean;
  /** 展开后的子实例列表 */
  subInstances: FanOutSubInstance[];
  /** 父实例 ID (即模板中定义的 instanceId) */
  parentInstanceId: string;
  /** 隔离策略 */
  isolationStrategy: "independent-sandbox" | "shared-with-paths";
}

/**
 * FanOutExpander — 根据 fanOut 配置动态展开子实例。
 *
 * 当模板 stage 配置了 fanOut 时，根据上游 ArchitectureDoc 的 modules 字段
 * (或 parallelizationHint) 拆分为多个并行子实例。
 */
export class FanOutExpander {
  private conditionEvaluator = new SafeConditionEvaluator();

  /**
   * 展开 fanOut stage 为子实例列表。
   *
   * @param templateStage 包含 fanOut 配置的模板 stage
   * @param run 当前 PipelineRun (用于获取上游输出)
   * @param upstreamOutputs 上游 stage 输出
   * @returns FanOutExpansion 结果
   */
  expand(
    templateStage: PipelineTemplate["stages"][number],
    _run: PipelineRun,
    upstreamOutputs: Map<string, unknown>,
  ): FanOutExpansion {
    const fanOutConfig = templateStage.fanOut!;

    // 评估 condition
    const shouldExpand = this.conditionEvaluator.evaluate(
      fanOutConfig.condition,
      upstreamOutputs,
      fanOutConfig,
    );

    if (!shouldExpand) {
      return {
        shouldExpand: false,
        subInstances: [],
        parentInstanceId: templateStage.instanceId,
        isolationStrategy: fanOutConfig.isolationStrategy,
      };
    }

    // 获取 sourceField 的值 (期望是 modules 数组)
    const sourceValue = this.conditionEvaluator.resolveDotPath(
      fanOutConfig.sourceField,
      upstreamOutputs,
    );

    const modules = this.extractModules(sourceValue);

    if (modules.length === 0) {
      return {
        shouldExpand: false,
        subInstances: [],
        parentInstanceId: templateStage.instanceId,
        isolationStrategy: fanOutConfig.isolationStrategy,
      };
    }

    // 使用 parallelizationHint 中的 splits（如果有），否则按模块平均分配
    const splits = this.buildSplits(modules, fanOutConfig.parallelism, sourceValue);

    const subInstances: FanOutSubInstance[] = splits.map((split, index) => ({
      instanceId: `${templateStage.instanceId}-${index}`,
      label: split.label,
      assignedModules: split.moduleIndices,
    }));

    return {
      shouldExpand: true,
      subInstances,
      parentInstanceId: templateStage.instanceId,
      isolationStrategy: fanOutConfig.isolationStrategy,
    };
  }

  /**
   * 从上游输出中提取模块列表
   */
  private extractModules(sourceValue: unknown): ArchitectureDoc["modules"] {
    if (Array.isArray(sourceValue)) {
      // sourceValue 本身就是 modules 数组
      return sourceValue as ArchitectureDoc["modules"];
    }

    if (sourceValue && typeof sourceValue === "object" && "modules" in sourceValue) {
      const modules = (sourceValue as ArchitectureDoc).modules;
      if (Array.isArray(modules)) return modules;
    }

    // 遍历上游输出查找包含 modules 的对象
    if (sourceValue && typeof sourceValue === "object") {
      const obj = sourceValue as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        const val = (obj as Record<string, unknown>)[key];
        if (val && typeof val === "object" && "modules" in val) {
          return (val as ArchitectureDoc).modules ?? [];
        }
      }
    }

    return [];
  }

  /**
   * 根据 parallelizationHint 或平均分配构建分片
   */
  private buildSplits(
    modules: ArchitectureDoc["modules"],
    parallelism: number,
    sourceValue: unknown,
  ): Array<{ label: string; moduleIndices: number[] }> {
    // 尝试使用 parallelizationHint
    if (sourceValue && typeof sourceValue === "object") {
      const hint = (sourceValue as ArchitectureDoc).parallelizationHint;
      if (hint && hint.splits.length > 0) {
        return hint.splits;
      }
    }

    // 平均分配模块到 parallelism 个分组
    const actualParallelism = Math.min(parallelism, modules.length);
    const splits: Array<{ label: string; moduleIndices: number[] }> = [];

    for (let i = 0; i < actualParallelism; i++) {
      const indices: number[] = [];
      for (let j = i; j < modules.length; j += actualParallelism) {
        indices.push(j);
      }
      splits.push({
        label: modules
          .filter((_, idx) => indices.includes(idx))
          .map((m) => m.name)
          .join(" + "),
        moduleIndices: indices,
      });
    }

    return splits;
  }

  /**
   * 为展开创建 StageRunRecord 子实例
   */
  createSubStageRecords(
    expansion: FanOutExpansion,
    parentRecord: StageRunRecord,
    executorId: string,
  ): StageRunRecord[] {
    return expansion.subInstances.map((sub, index) => ({
      instanceId: sub.instanceId,
      stageId: parentRecord.stageId,
      executorId,
      status: "pending" as StageRunStatus,
      input: undefined,
      output: undefined,
      errors: [],
      attempt: 0,
      fanOutParentInstanceId: expansion.parentInstanceId,
      fanOutIndex: index,
    }));
  }

  /**
   * 检查是否需要进行 fanOut 展开
   */
  shouldFanOut(
    templateStage: PipelineTemplate["stages"][number],
    upstreamOutputs: Map<string, unknown>,
  ): boolean {
    if (!templateStage.fanOut) return false;

    return this.conditionEvaluator.evaluate(
      templateStage.fanOut.condition,
      upstreamOutputs,
      templateStage.fanOut,
    );
  }
}
