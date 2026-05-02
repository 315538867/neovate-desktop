/**
 * Detection helpers for Claude Code's compact-summary user message.
 *
 * Background: When a session is compacted, Claude Code injects a synthetic
 * `user` message whose text starts with `COMPACT_SUMMARY_PREFIX`. The SDK's
 * `getSessionMessages` strips the `isCompactSummary: true` flag from this
 * message, so we identify it by the prefix instead.
 */

export const COMPACT_SUMMARY_PREFIX =
  "This session is being continued from a previous conversation that ran out of context.";

/**
 * Pull plain text from a user message's `content` field, which may be either
 * a string or an Array of typed blocks (text/image/...).
 */
export function extractTextFromUserContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: { type?: string }) => b?.type === "text")
      .map((b: { text?: string }) => b.text ?? "")
      .join("");
  }
  return "";
}

/**
 * Returns true when `text` is the auto-injected compact-summary user message.
 * We tolerate leading whitespace defensively.
 */
export function isCompactSummaryText(text: string): boolean {
  if (typeof text !== "string" || text.length === 0) return false;
  return text.trimStart().startsWith(COMPACT_SUMMARY_PREFIX);
}
