/**
 * Convert a TipTap JSON document into a structured part array used by the
 * optimistic user-message push in `chat.ts`.
 *
 * Why this exists: the input editor preserves slash commands as atom
 * `slashCommand` nodes (only insertable via the suggestion list, so a node's
 * presence already proves the command is real). When the user hits send we
 * traditionally `extractText` the doc into a flat string — which loses that
 * structural signal, leaving the optimistic chat message as plain text while
 * the *replayed* version (parsed from the CLI XML envelope by
 * `parseCliUserContent`) renders as a chip. This util keeps the two paths
 * symmetric by emitting `data-slash-command` parts directly from the editor
 * tree, so the renderer sees identical shapes regardless of provenance.
 *
 * The shape mirrors `parseCliUserContent`'s output: `name` is the bare command
 * (no leading `/`), so downstream `SlashCommandBlock` re-prepends it.
 */

import type { JSONContent } from "@tiptap/react";

import type { ClaudeCodeUIMessage } from "../../../../../shared/claude-code/types";

import { extractReadableUserText } from "../../../../../shared/claude-code/extract-readable-user-text";

type Part = ClaudeCodeUIMessage["parts"][number];

export type ExtractedSendable = {
  /** Flat string still used for `transport.send` and SDK round-trip. */
  text: string;
  /** Structured parts. Always populated — caller passes them straight through
   *  to the optimistic push path; `extractReadableUserText` collapses them
   *  back to plain text when the SDK needs a string. */
  parts: Part[];
};

export function extractParts(doc: JSONContent): ExtractedSendable {
  const parts: Part[] = [];
  const textBuf: string[] = [];

  // Mirror extractText so the string output stays byte-identical for the
  // non-slash-command path. When we hit a slashCommand node we flush the
  // accumulated text to a `text` part, then emit a `data-slash-command` part.
  const flushText = () => {
    if (textBuf.length === 0) return;
    const merged = textBuf.join("");
    textBuf.length = 0;
    if (merged.length === 0) return;
    parts.push({ type: "text", text: merged, state: "done" } as Part);
  };

  function walk(node: JSONContent) {
    if (node.type === "text") {
      textBuf.push(node.text ?? "");
      return;
    }
    if (node.type === "mention") {
      textBuf.push(`@${node.attrs?.id ?? node.attrs?.label ?? ""}`);
      return;
    }
    if (node.type === "slashCommand") {
      flushText();
      const rawLabel = String(node.attrs?.label ?? "");
      const name = rawLabel.replace(/^\/+/, "").trim();
      if (name.length > 0) {
        parts.push({
          type: "data-slash-command",
          data: { name },
        } as Part);
      }
      return;
    }
    if (node.type === "hardBreak") {
      textBuf.push("\n");
      return;
    }
    if (node.type === "codeBlock") {
      const code = (node.content ?? []).map((c) => c.text ?? "").join("");
      textBuf.push("```\n" + code + "\n```");
      return;
    }
    if (node.content) {
      node.content.forEach(walk);
    }
    if (node.type === "paragraph") {
      textBuf.push("\n");
    }
  }

  if (doc.content) doc.content.forEach(walk);
  flushText();

  // Trim leading/trailing whitespace at the boundaries (matches extractText).
  // We do this on the parts in-place so the optimistic message doesn't carry
  // a stray newline before/after a chip when the user only typed `/cmd`.
  trimEdgeText(parts);

  // Single source of truth: derive the flat text from the same helper used by
  // sidebar titles, rewind prefill, and main-process SDK input. Eliminates a
  // duplicate slash-command serialiser that we had to keep in sync by hand.
  const text = extractReadableUserText(parts).trim();
  return { parts, text };
}

function trimEdgeText(parts: Part[]): void {
  if (parts.length === 0) return;
  const first = parts[0];
  if (first.type === "text") {
    const trimmed = (first as { text: string }).text.replace(/^\s+/, "");
    if (trimmed.length === 0) {
      parts.shift();
    } else {
      (first as { text: string }).text = trimmed;
    }
  }
  if (parts.length === 0) return;
  const last = parts[parts.length - 1];
  if (last.type === "text") {
    const trimmed = (last as { text: string }).text.replace(/\s+$/, "");
    if (trimmed.length === 0) {
      parts.pop();
    } else {
      (last as { text: string }).text = trimmed;
    }
  }
}
