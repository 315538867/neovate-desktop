/**
 * Pure helpers that produce UI message parts and chunks from raw SDK content.
 *
 * Pulled out of `SDKMessageTransformer` to keep the class focused on its
 * stateful streaming state machine. Every function here is pure (no class
 * state, no side effects) — when a helper needs the transformer's
 * `rootParentToolUseId`, it is passed as an explicit argument.
 *
 * Behavior must remain bit-for-bit identical to the inlined versions —
 * pure relocation, not a redesign.
 */

import type {
  ClaudeCodeUIMessage,
  ClaudeCodeUIMessageChunk,
} from "../../../../shared/claude-code/types";

import { parseCliUserContent } from "../../../../shared/claude-code/parse-cli-user-content";
import {
  isBase64ImageSource,
  isImageContentBlock,
  isStringResultObject,
  isTextContentBlock,
  isUrlImageSource,
} from "./type-guards";

/** Stable per-part id for a text content block within a streamed assistant message. */
export function textPartId(messageId: string, index: number): string {
  return `text:${messageId}:${index}`;
}

/** Stable per-part id for a reasoning (thinking) content block. */
export function reasoningPartId(messageId: string, index: number): string {
  return `reasoning:${messageId}:${index}`;
}

/**
 * True when the message has no parent tool use, or the parent matches the
 * root parent of the active transformer (i.e. the kickoff prompt that
 * spawned this sub-conversation).
 */
export function isTopLevelParent(
  parentToolUseId: string | null | undefined,
  rootParentToolUseId: string | null,
): boolean {
  return parentToolUseId == null || parentToolUseId === rootParentToolUseId;
}

/**
 * Producer-side metadata describing whether a chunk is nested inside a
 * parent Claude Code tool. Returns `undefined` when at top level so the
 * field is omitted from the chunk.
 */
export function claudeCodeMetadata(
  parentToolUseId: string | null | undefined,
  rootParentToolUseId: string | null,
) {
  return isTopLevelParent(parentToolUseId, rootParentToolUseId)
    ? undefined
    : { claudeCode: { parentToolUseId } };
}

/**
 * Legacy parser for Read-tool content: split into joined text + image
 * source list. Used both for live tool results and for the on-restore
 * fallback when `tool_use_result` has been stripped from .jsonl.
 */
export function parseReadToolContentLegacy(content: unknown): {
  text: string;
  images: { url: string; mediaType: string; filename?: string }[];
} {
  if (typeof content === "string") return { text: content, images: [] };
  if (!Array.isArray(content))
    return { text: content != null ? JSON.stringify(content) : "", images: [] };

  const texts: string[] = [];
  const images: { url: string; mediaType: string; filename?: string }[] = [];
  for (const block of content) {
    if (isTextContentBlock(block)) {
      texts.push(block.text);
    } else if (isImageContentBlock(block)) {
      const src = block.source;
      if (isBase64ImageSource(src)) {
        images.push({
          url: `data:${src.media_type || "image/png"};base64,${src.data}`,
          mediaType: src.media_type || "image/png",
          filename: block.filename,
        });
      } else if (isUrlImageSource(src)) {
        images.push({
          url: src.url,
          mediaType: src.media_type || "image/png",
          filename: block.filename,
        });
      }
    }
  }
  return { text: texts.join("\n"), images };
}

/** Extract image parts (UI 'file' parts) from arbitrary tool result content. */
export function extractImageParts(result: unknown): ClaudeCodeUIMessage["parts"] {
  const { images } = parseReadToolContentLegacy(result);
  return images.map((img) => ({
    type: "file" as const,
    mediaType: img.mediaType,
    url: img.url,
    filename: img.filename,
  }));
}

/**
 * Flatten arbitrary tool-result content into a list of text segments.
 * Falls back to a generic "Task failed/completed" string when no usable
 * text is present.
 */
export function resultContentToTexts(result: unknown, isError: boolean): string[] {
  const texts: string[] = [];

  if (typeof result === "string") {
    texts.push(result);
  } else if (Array.isArray(result)) {
    for (const part of result) {
      if (isTextContentBlock(part)) {
        texts.push(part.text);
      }
    }
  } else if (isStringResultObject(result)) {
    texts.push(result.result);
  } else if (result != null) {
    texts.push(JSON.stringify(result));
  }

  return texts.length === 0 ? [isError ? "Task failed" : "Task completed"] : texts;
}

/** Single-line variant of resultContentToTexts. */
export function resultContentToText(result: unknown, isError: boolean): string {
  return resultContentToTexts(result, isError).join("\n");
}

/** Build the UI message parts (image parts + text parts) for a tool result. */
export function resultContentToMessageParts(
  result: unknown,
  isError: boolean,
): ClaudeCodeUIMessage["parts"] {
  const parts: ClaudeCodeUIMessage["parts"] = [];

  // Handle image outputs
  const imageParts = extractImageParts(result);
  for (const imagePart of imageParts) {
    parts.push(imagePart);
  }

  // Handle text outputs
  const texts = resultContentToTexts(result, isError);
  for (const text of texts) {
    parts.push({
      type: "text" as const,
      text,
      state: "done" as const,
    });
  }

  return parts;
}

/**
 * Finalize the aggregated agent (Task/Agent) sub-conversation as a single
 * assistant ClaudeCodeUIMessage that becomes the parent tool's output.
 */
export function finalizeAgentMessage({
  toolCallId,
  sessionId,
  baseMessage,
  result,
  isError,
}: {
  toolCallId: string;
  sessionId: string;
  baseMessage?: ClaudeCodeUIMessage;
  result: unknown;
  isError: boolean;
}): ClaudeCodeUIMessage {
  const parts = [...(baseMessage?.parts ?? []), ...resultContentToMessageParts(result, isError)];

  return {
    id: `agent:${toolCallId}`,
    role: "assistant",
    metadata: {
      sessionId,
      parentToolUseId: null,
    },
    parts,
  } as ClaudeCodeUIMessage;
}

/**
 * Parse a raw user text payload through the CLI protocol→semantic translator
 * and yield the corresponding chunks (text and/or `data-slash-command`).
 * Empty input emits nothing — callers should pre-skip if they want a
 * different fallback.
 */
export function* emitParsedUserText(
  text: string,
  uuid: string,
): Generator<ClaudeCodeUIMessageChunk> {
  const parsed = parseCliUserContent(text);
  if (parsed.parts.length === 0) return;
  let counter = 0;
  for (const part of parsed.parts) {
    if (part.type === "data-slash-command") {
      yield {
        type: "data-slash-command",
        id: `${uuid}-cmd-${counter++}`,
        data: part.data,
      };
    } else if (part.type === "text") {
      const textId = `${uuid}-text-${counter++}`;
      yield { type: "text-start", id: textId };
      yield { type: "text-delta", id: textId, delta: part.text };
      yield { type: "text-end", id: textId };
    }
  }
}
