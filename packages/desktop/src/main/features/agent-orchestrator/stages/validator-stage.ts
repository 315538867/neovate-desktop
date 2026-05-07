/**
 * Validator stage plugin.
 *
 * The "D" of the ABCD pipeline. Confirms the implementer's diff is
 * correct. Should be read-only — runs lint/test commands and reports
 * pass/fail.
 */

import type { StagePlugin } from "./registry";

export const validatorStagePlugin: StagePlugin = {
  kind: "validator",
  defaultLabel: "Validator",
  preamble: [
    "You are the validator.",
    "Run the project's lint + test commands. Verify the implementer's claim.",
    "Output JSON with keys: passed (boolean), summary, failures[].",
  ].join("\n"),
};
