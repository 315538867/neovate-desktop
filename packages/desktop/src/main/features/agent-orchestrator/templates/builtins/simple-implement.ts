import type { PipelineTemplate } from "../../../../../shared/features/agent-orchestrator/schemas";

export const simpleImplementTemplate: PipelineTemplate = {
  id: "simple-implement",
  displayName: "简单实施",
  description: "单阶段直接实施，适合小型明确的任务",
  stages: [
    {
      stageId: "implementer",
      instanceId: "C",
      dependsOn: [],
      optional: false,
      userGate: "after",
      repeatCondition: "on-user-request",
      maxRetries: 2,
    },
  ],
  defaultExecutorMap: {
    C: "claude-code",
  },
};
