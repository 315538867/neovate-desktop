/**
 * Architect stage plugin.
 *
 * The "A" of the ABCD pipeline. Designed for high-level planning before
 * implementation. Defaults to `llm-only` (chat) but templates may
 * override per stage.
 */

import type { StagePlugin } from "./registry";

export const architectStagePlugin: StagePlugin = {
  kind: "architect",
  defaultLabel: "Architect",
  preamble: [
    "You are the architect for this run.",
    "Produce a concise plan: goal, key files, risks, success criteria.",
    "Do not edit files. Output JSON with keys: plan, files, risks.",
  ].join("\n"),
};
