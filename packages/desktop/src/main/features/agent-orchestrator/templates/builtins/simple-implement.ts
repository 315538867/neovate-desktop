/**
 * Built-in template: `simple-implement`.
 *
 * Single-stage pipeline that delegates the entire task to the
 * implementer with the Claude Agent SDK. Useful as the default for
 * "just do this thing" requests.
 */

import type { PipelineTemplate } from "../../../../../shared/features/agent-orchestrator/types";

export const simpleImplementTemplate: PipelineTemplate = {
  id: "simple-implement",
  name: "Simple Implement",
  description: "Single-stage Claude Code execution. No review or validation gates.",
  version: "1.0.0",
  source: "builtin",
  defaultBudget: {
    maxStages: 1,
    maxDurationMs: 30 * 60_000,
  },
  stages: [
    {
      id: "implement",
      kind: "implementer",
      executor: "claude-code",
      label: "Implement",
      dependsOn: [],
      prompt: "{{task}}",
      userGate: false,
    },
  ],
};
