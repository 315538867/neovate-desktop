import type { StagePlugin } from "../../../../shared/features/agent-orchestrator/executor-types";
import type { PipelineContext } from "../../../../shared/features/agent-orchestrator/executor-types";
import type {
  AcceptanceReport,
  ImplementationResult,
} from "../../../../shared/features/agent-orchestrator/schemas";

import {
  AcceptanceReportSchema,
  ImplementationResultSchema,
} from "../../../../shared/features/agent-orchestrator/schemas";

export class ValidatorStage implements StagePlugin<ImplementationResult, AcceptanceReport> {
  readonly id = "validator";
  readonly displayName = "Validator";
  readonly description = "验证实现结果与架构设计的一致性";

  inputSchema = ImplementationResultSchema;
  outputSchema = AcceptanceReportSchema;

  requiredCapabilities = {
    structuredOutput: true,
    maxContextTokens: 100_000,
  };

  defaultSystemPrompt = `你是一位质量保证工程师。验证以下实现结果，评估其质量以及与架构设计的一致性。

输出格式：JSON，包含以下字段：
- decision: "accepted" | "rejected" | "accepted_with_followups"
- score: 0-10 的整数
- defects: 发现的缺陷列表（severity, file?, problem, fixHint）
- matchesArchitecture: 是否与架构设计一致
- followups: 后续需要跟进的事项

验证要点：
1. 实现是否完整覆盖了架构设计中的模块
2. 接口签名是否与设计一致
3. 是否有明显的 bug 或逻辑错误
4. 代码变更是否合理`;

  buildInput(_ctx: PipelineContext, upstreamOutputs: Map<string, unknown>): ImplementationResult {
    for (const output of upstreamOutputs.values()) {
      const result = output as ImplementationResult;
      if (result.filesChanged && result.status) return result;
    }
    return {
      status: "failed",
      filesChanged: [],
      subtaskLog: [],
      unresolvedIssues: [],
      summary: "",
    };
  }
}
