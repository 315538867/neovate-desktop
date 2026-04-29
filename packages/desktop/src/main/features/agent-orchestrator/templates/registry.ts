import type { PipelineTemplate } from "../../../../shared/features/agent-orchestrator/schemas";

import { architectParallelBuildVerifyTemplate } from "./builtins/architect-parallel-build-verify";
import { architectReviewBuildVerifyTemplate } from "./builtins/architect-review-build-verify";
import { simpleImplementTemplate } from "./builtins/simple-implement";

const builtins: PipelineTemplate[] = [
  simpleImplementTemplate,
  architectReviewBuildVerifyTemplate,
  architectParallelBuildVerifyTemplate,
];

const customTemplates = new Map<string, PipelineTemplate>();

export function getBuiltinTemplates(): PipelineTemplate[] {
  return builtins;
}

export function registerTemplate(template: PipelineTemplate): void {
  customTemplates.set(template.id, template);
}

export function getTemplate(id: string): PipelineTemplate | undefined {
  const builtin = builtins.find((t) => t.id === id);
  if (builtin) return builtin;
  return customTemplates.get(id);
}

export function listTemplates(): PipelineTemplate[] {
  return [...builtins, ...customTemplates.values()];
}
