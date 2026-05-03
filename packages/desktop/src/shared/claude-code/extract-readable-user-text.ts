import type { ClaudeCodeUIMessage } from "./types";

/**
 * Render the human-readable text of a user message — what the user would
 * recognise as "what they typed". Used by sidebar titles and rewind prefill.
 *
 * - `text` parts are emitted verbatim.
 * - `data-slash-command` parts collapse back to their visible form
 *   `/<name> <args>` (matching how the chip is rendered, Q2=b).
 *   Side-effect fields (stdout/caveat) are intentionally omitted — they're
 *   CLI output, not user input.
 * - Other part types (file, reasoning, tool, etc.) are skipped.
 *
 * Adjacent fragments are joined by `joiner` (default: empty string), since
 * the original turn was conceptually a single utterance.
 */
export function extractReadableUserText(
  parts: ClaudeCodeUIMessage["parts"] | undefined,
  joiner: string = "",
): string {
  if (!parts || parts.length === 0) return "";

  const fragments: string[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string" && text.length > 0) fragments.push(text);
      continue;
    }
    if (part.type === "data-slash-command") {
      const data = (part as { data?: { name?: string; args?: string } }).data;
      const name = data?.name;
      if (typeof name !== "string" || name.length === 0) continue;
      const args = typeof data?.args === "string" && data.args.length > 0 ? ` ${data.args}` : "";
      fragments.push(`/${name}${args}`);
      continue;
    }
    // Other part types contribute nothing to a user-recognisable text view.
  }

  return fragments.join(joiner);
}
