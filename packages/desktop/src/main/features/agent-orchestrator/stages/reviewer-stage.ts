import type { StagePlugin } from "../../../../shared/features/agent-orchestrator/executor-types";
import type { PipelineContext } from "../../../../shared/features/agent-orchestrator/executor-types";
import type {
  ArchitectureDoc,
  ReviewReport,
} from "../../../../shared/features/agent-orchestrator/schemas";

import {
  ArchitectureDocSchema,
  ReviewReportSchema,
} from "../../../../shared/features/agent-orchestrator/schemas";

export class ReviewerStage implements StagePlugin<ArchitectureDoc, ReviewReport> {
  readonly id = "reviewer";
  readonly displayName = "Reviewer";
  readonly description = "审查架构设计并生成审查报告";

  inputSchema = ArchitectureDocSchema;
  outputSchema = ReviewReportSchema;

  requiredCapabilities = {
    structuredOutput: true,
    maxContextTokens: 100_000,
  };

  defaultSystemPrompt = `你是一位资深代码审查员。审查以下架构设计文档并生成审查报告。

输出格式：JSON，包含以下字段：
- decision: "approved" | "rejected" | "approved_with_concerns"
- score: 0-10 的整数
- issues: 问题列表（severity: "blocker"|"major"|"minor", location, problem, suggestion）
- strengths: 设计优点列表

审查要点：
1. 模块划分是否合理
2. 接口设计是否清晰
3. 风险评估是否充分
4. 是否有遗漏的关键场景`;

  buildInput(_ctx: PipelineContext, upstreamOutputs: Map<string, unknown>): ArchitectureDoc {
    // 从上游（Architect）获取 ArchitectureDoc
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
}
