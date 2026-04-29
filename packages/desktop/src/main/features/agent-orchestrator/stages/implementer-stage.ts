import type { StagePlugin } from "../../../../shared/features/agent-orchestrator/executor-types";
import type { PipelineContext } from "../../../../shared/features/agent-orchestrator/executor-types";
import type {
  ArchitectureDoc,
  ImplementationResult,
} from "../../../../shared/features/agent-orchestrator/schemas";

import {
  ArchitectureDocSchema,
  ImplementationResultSchema,
} from "../../../../shared/features/agent-orchestrator/schemas";

export class ImplementerStage implements StagePlugin<ArchitectureDoc, ImplementationResult> {
  readonly id = "implementer";
  readonly displayName = "Implementer";
  readonly description = "根据架构设计执行代码实现";

  inputSchema = ArchitectureDocSchema;
  outputSchema = ImplementationResultSchema;

  requiredCapabilities = {
    streaming: true,
    fileTools: true,
    shellTools: true,
    maxContextTokens: 150_000,
  };

  defaultSystemPrompt = `你是一位高级软件工程师。根据以下架构设计文档实现代码。

请按照架构设计中的模块拆分，逐个实现每个模块的代码变更。

输出格式（完成所有任务后）：JSON，包含以下字段：
- status: "success" | "partial" | "failed"
- filesChanged: 文件变更列表
- subtaskLog: 子任务日志
- unresolvedIssues: 未解决的问题
- summary: 实现总结`;

  buildInput(_ctx: PipelineContext, upstreamOutputs: Map<string, unknown>): ArchitectureDoc {
    for (const output of upstreamOutputs.values()) {
      const doc = output as ArchitectureDoc;
      if (doc.modules && doc.goal) return doc;
    }
    return {
      goal: "",
      approach: "",
      modules: [],
      interfaces: [],
      risks: [],
      outOfScope: [],
      estimatedSubtasks: [],
    };
  }

  customizePrompt(executor: unknown, basePrompt: string): string {
    const caps = (executor as { capabilities?: { fileTools?: boolean; shellTools?: boolean } })
      .capabilities;
    if (caps?.fileTools && caps?.shellTools) {
      return `${basePrompt}\n\n你可以使用文件工具和 Shell 工具来完成任务。完成所有实现后，请输出结构化 JSON 报告。`;
    }
    return `${basePrompt}\n\n请以文本形式输出每个文件的完整代码。`;
  }
}
