/**
 * Built-in template: `architect-review-build-verify` (ABCD).
 *
 * The full ABCD pipeline. Architect plans → Reviewer critiques (gate) →
 * Implementer applies edits → Validator runs lint/test.
 */

import type { PipelineTemplate } from "../../../../../shared/features/agent-orchestrator/types";

export const architectReviewBuildVerifyTemplate: PipelineTemplate = {
  id: "architect-review-build-verify",
  name: "Architect → Review → Build → Verify",
  description: "Full ABCD pipeline with a user gate after review.",
  version: "1.0.0",
  source: "builtin",
  defaultBudget: {
    maxStages: 4,
    maxDurationMs: 90 * 60_000,
  },
  stages: [
    {
      id: "architect",
      kind: "architect",
      executor: "llm-only",
      label: "Architect",
      dependsOn: [],
      prompt: "Plan the following task: {{task}}",
      userGate: false,
    },
    {
      id: "reviewer",
      kind: "reviewer",
      executor: "llm-only",
      label: "Reviewer",
      dependsOn: ["architect"],
      prompt: "Review this plan and surface concerns:\n{{architect.summary}}",
      userGate: true,
    },
    {
      id: "implementer",
      kind: "implementer",
      executor: "claude-code",
      label: "Implementer",
      dependsOn: ["reviewer"],
      prompt: [
        "Implement the plan after reviewer approval:",
        "Plan: {{architect.summary}}",
        "Concerns to address: {{reviewer.summary}}",
        "",
        "Original task: {{task}}",
      ].join("\n"),
      userGate: false,
    },
    {
      id: "validator",
      kind: "validator",
      executor: "claude-code",
      label: "Validator",
      dependsOn: ["implementer"],
      prompt: "Validate the implementation: run lint + tests and report status.",
      userGate: false,
    },
  ],
};
