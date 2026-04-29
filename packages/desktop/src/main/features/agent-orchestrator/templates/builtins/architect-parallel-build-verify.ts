import type { PipelineTemplate } from "../../../../../shared/features/agent-orchestrator/schemas";

export const architectParallelBuildVerifyTemplate: PipelineTemplate = {
  id: "architect-parallel-build-verify",
  displayName: "并行实施: 架构→并行实施→验收",
  description: "架构师设计后，根据模块拆分为多个并行实施，最终合并验收",
  stages: [
    {
      stageId: "architect",
      instanceId: "A",
      dependsOn: [],
      optional: false,
      userGate: "after",
      repeatCondition: "on-user-request",
      maxRetries: 2,
      timeoutMs: 5 * 60_000,
    },
    {
      stageId: "implementer",
      instanceId: "C",
      dependsOn: ["A"],
      optional: false,
      userGate: "after",
      repeatCondition: "on-failure",
      maxRetries: 2,
      timeoutMs: 30 * 60_000,
      fanOut: {
        sourceField: "modules",
        parallelism: 3,
        condition: "modules.length > 1",
        isolationStrategy: "independent-sandbox",
      },
    },
    {
      stageId: "validator",
      instanceId: "D",
      dependsOn: ["C"],
      optional: true,
      userGate: "after",
      repeatCondition: "on-user-request",
      maxRetries: 1,
      timeoutMs: 5 * 60_000,
      fanIn: {
        aggregatorId: "merge-impl-results",
      },
    },
  ],
  defaultExecutorMap: {
    A: "llm-only",
    C: "claude-code",
    D: "llm-only",
  },
};
