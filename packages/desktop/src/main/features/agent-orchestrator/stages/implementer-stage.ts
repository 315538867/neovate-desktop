/**
 * Implementer stage plugin.
 *
 * The "C" of the ABCD pipeline. Performs the actual file edits. Defaults
 * to `claude-code` so the SessionManager can use real tools.
 */

import type { StagePlugin } from "./registry";

export const implementerStagePlugin: StagePlugin = {
  kind: "implementer",
  defaultLabel: "Implementer",
  preamble: [
    "You are the implementer.",
    "Apply the upstream plan. Make the smallest change that satisfies it.",
    "Edit files using your tools. Report changedFiles in your final response.",
  ].join("\n"),
};
