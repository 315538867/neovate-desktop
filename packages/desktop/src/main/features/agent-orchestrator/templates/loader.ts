/**
 * Agent Orchestrator — TemplateLoader.
 *
 * Loads user-supplied templates from a project's `.zcf/orchestrator/`
 * directory or a global config path. Falls back gracefully when no
 * templates are present.
 *
 * Templates are validated via Zod (`pipelineTemplateSchema`) before
 * registration so malformed JSON is rejected with a useful error.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";

import type { PipelineTemplate } from "../../../../shared/features/agent-orchestrator/types";

import { pipelineTemplateSchema } from "../../../../shared/features/agent-orchestrator/schemas";
import { architectParallelBuildVerifyTemplate } from "./builtins/architect-parallel-build-verify";
import { architectReviewBuildVerifyTemplate } from "./builtins/architect-review-build-verify";
import { simpleImplementTemplate } from "./builtins/simple-implement";
import { TemplateRegistry } from "./registry";

export const BUILTIN_TEMPLATES: ReadonlyArray<PipelineTemplate> = [
  simpleImplementTemplate,
  architectReviewBuildVerifyTemplate,
  architectParallelBuildVerifyTemplate,
];

export type LoadOptions = {
  /** Project-local templates dir (defaults to `<cwd>/.zcf/orchestrator`). */
  projectTemplatesDir?: string;
  /** Global templates dir (defaults to `<userData>/orchestrator/templates`). */
  globalTemplatesDir?: string;
};

/**
 * Build a registry containing the built-in templates plus any user
 * overrides loaded from disk. Errors loading user templates are
 * non-fatal — the function returns the registry it managed to build.
 */
export async function loadTemplateRegistry(
  options: LoadOptions = {},
): Promise<{ registry: TemplateRegistry; errors: Error[] }> {
  const registry = new TemplateRegistry();
  for (const t of BUILTIN_TEMPLATES) registry.register(t);

  const errors: Error[] = [];
  for (const dir of [options.projectTemplatesDir, options.globalTemplatesDir]) {
    if (!dir) continue;
    try {
      const more = await readTemplatesFromDir(dir);
      for (const tpl of more) {
        try {
          registry.upsert(tpl);
        } catch (err) {
          errors.push(toError(err));
        }
      }
    } catch (err) {
      // ENOENT is fine; anything else we surface upstream.
      const e = toError(err);
      if (!isMissingDirError(err)) errors.push(e);
    }
  }
  return { registry, errors };
}

async function readTemplatesFromDir(dir: string): Promise<PipelineTemplate[]> {
  const entries = await fs.readdir(dir);
  const out: PipelineTemplate[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const text = await fs.readFile(join(dir, name), "utf8");
    const parsed = JSON.parse(text) as unknown;
    const tpl = pipelineTemplateSchema.parse(parsed);
    out.push(tpl);
  }
  return out;
}

function isMissingDirError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: string }).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
