import type { StagePlugin } from "../../../../shared/features/agent-orchestrator/executor-types";
import type { PipelineContext } from "../../../../shared/features/agent-orchestrator/executor-types";
import type {
  ArchitectureDoc,
  TaskInput,
} from "../../../../shared/features/agent-orchestrator/schemas";

import {
  ArchitectureDocSchema,
  TaskInputSchema,
} from "../../../../shared/features/agent-orchestrator/schemas";

export class ArchitectStage implements StagePlugin<TaskInput, ArchitectureDoc> {
  readonly id = "architect";
  readonly displayName = "Architect";
  readonly description = "分析需求并生成架构设计文档";

  inputSchema = TaskInputSchema;
  outputSchema = ArchitectureDocSchema;

  requiredCapabilities = {
    structuredOutput: true,
    maxContextTokens: 100_000,
  };

  defaultSystemPrompt = `你是一位资深软件架构师。分析用户需求并生成详细的架构设计文档。

输出格式：JSON，包含以下字段：
- goal: 目标描述
- approach: 技术方案
- modules: 模块列表（name, path, responsibility, changes）
- interfaces: 接口定义（name, signature, rationale）
- risks: 风险列表
- outOfScope: 明确不在范围内的事项
- estimatedSubtasks: 预估子任务
- parallelizationHint?: 并行化提示

注意：
1. 合理拆分模块，每个模块职责单一
2. 分析潜在风险并给出缓解建议
3. 对于可以并行工作的模块，在 parallelizationHint 中标注`;

  buildInput(ctx: PipelineContext, _upstreamOutputs: Map<string, unknown>): TaskInput {
    return ctx.taskInput;
  }

  customizePrompt(_executor: unknown, basePrompt: string): string {
    return basePrompt;
  }
}
