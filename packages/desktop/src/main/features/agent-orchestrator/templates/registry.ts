/**
 * Agent Orchestrator — PipelineTemplate registry.
 *
 * Holds built-in templates plus any user-supplied ones loaded by
 * `loader.ts`. Templates are validated against the DAG validator at
 * registration time so we fail fast (no orchestrator surprises mid-run).
 */

import type { PipelineTemplate } from "../../../../shared/features/agent-orchestrator/types";

import { validateDagOrThrow } from "../dag/dag-validator";

export class TemplateRegistry {
  private readonly templates = new Map<string, PipelineTemplate>();

  register(template: PipelineTemplate): void {
    validateDagOrThrow(template);
    if (this.templates.has(template.id)) {
      throw new Error(`TemplateRegistry: duplicate template id="${template.id}"`);
    }
    this.templates.set(template.id, template);
  }

  /** Replace an existing template — used by the loader on hot-reload. */
  upsert(template: PipelineTemplate): void {
    validateDagOrThrow(template);
    this.templates.set(template.id, template);
  }

  has(id: string): boolean {
    return this.templates.has(id);
  }

  resolve(id: string): PipelineTemplate | undefined {
    return this.templates.get(id);
  }

  list(): PipelineTemplate[] {
    return Array.from(this.templates.values()).sort((a, b) => a.id.localeCompare(b.id));
  }

  remove(id: string): void {
    this.templates.delete(id);
  }
}
