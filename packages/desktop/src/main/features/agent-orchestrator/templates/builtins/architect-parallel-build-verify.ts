/**
 * Built-in template: `architect-parallel-build-verify`.
 *
 * Architect plans, then fan-out runs three implementer branches in
 * parallel sandboxes (each on its own worktree). Validator picks the
 * passing branch. Demonstrates the fan-out / sandbox surface.
 */

import type { PipelineTemplate } from "../../../../../shared/features/agent-orchestrator/types";

export const architectParallelBuildVerifyTemplate: PipelineTemplate = {
  id: "architect-parallel-build-verify",
  name: "Architect → Parallel Build → Verify",
  description: "Plan once, then implement three approaches in parallel sandboxes.",
  version: "1.0.0",
  source: "builtin",
  defaultBudget: {
    maxStages: 5,
    maxDurationMs: 120 * 60_000,
  },
  stages: [
    {
      id: "architect",
      kind: "architect",
      executor: "llm-only",
      label: "Architect",
      dependsOn: [],
      prompt: "Plan the task and propose three distinct approaches:\n{{task}}",
      userGate: false,
    },
    {
      id: "implementer",
      kind: "implementer",
      executor: "claude-code",
      label: "Implementer (parallel)",
      dependsOn: ["architect"],
      prompt: "Implement approach `{{branch}}` for the task.\n\nPlan:\n{{architect.summary}}",
      fanout: { kind: "static", variants: ["alpha", "beta", "gamma"] },
      sandbox: { worktree: true, branchTemplate: "orchestrator/{runId}/{stageId}-{branchIndex}" },
      userGate: false,
    },
    {
      id: "validator",
      kind: "validator",
      executor: "claude-code",
      label: "Validator",
      dependsOn: ["implementer"],
      prompt: "Inspect the parallel branches and pick the best by lint + test outcome.",
      userGate: true,
    },
  ],
};
