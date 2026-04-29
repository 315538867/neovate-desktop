import type { StagePlugin } from "../../../../shared/features/agent-orchestrator/executor-types";

const stages = new Map<string, StagePlugin>();

export function registerStage(plugin: StagePlugin): void {
  stages.set(plugin.id, plugin);
}

export function getStage(id: string): StagePlugin | undefined {
  return stages.get(id);
}

export function listStages(): StagePlugin[] {
  return Array.from(stages.values());
}

/**
 * 校验 output schema → 下游 input schema 兼容性。
 * 当前仅做浅层校验（两个 schema 是否相同类型）。
 * 后续可扩展为结构兼容性检查。
 */
export function validateStageCompatibility(
  upstream: StagePlugin,
  downstream: StagePlugin,
): boolean {
  // 检查下游 input schema 是否接受上游 output schema 的结构
  try {
    // 使用一个示例值测试兼容性
    const sampleOutput = upstream.outputSchema.safeParse({});
    if (!sampleOutput.success) {
      // 无法生成示例，返回 true 依赖运行时校验
      return true;
    }
    const testInput = downstream.inputSchema.safeParse(sampleOutput.data);
    return testInput.success;
  } catch {
    return true;
  }
}
