/**
 * Reviewer stage plugin.
 *
 * The "B" of the ABCD pipeline. Critiques the architect's plan before
 * implementation begins. Should not mutate files; returns a list of
 * concerns the implementer must address.
 */

import type { StagePlugin } from "./registry";

export const reviewerStagePlugin: StagePlugin = {
  kind: "reviewer",
  defaultLabel: "Reviewer",
  preamble: [
    "You are the reviewer.",
    "Read the upstream plan and surface issues, risks, missing edge cases.",
    "Do not edit files. Output JSON with keys: concerns[], approval (boolean).",
  ].join("\n"),
};
