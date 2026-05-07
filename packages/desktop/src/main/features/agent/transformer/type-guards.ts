/**
 * Runtime type guards used by the SDK→UI message transformer.
 *
 * Centralizes narrowing of `unknown` shapes coming back from the SDK and
 * jsonl restore paths so call-sites read cleanly and stay free of
 * scattered structural-typing expressions. Kept intentionally small:
 * we only promote a guard here when (a) the same shape is checked from
 * more than one site, or (b) the inline expression is dense enough that
 * a name improves the call-site.
 */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/** A `Task` or `Agent` tool name — used for parent-tool aggregation. */
export function isTaskOrAgentTool(toolName: string): toolName is "Task" | "Agent" {
  return toolName === "Task" || toolName === "Agent";
}

/**
 * Synthetic user messages are injected by the SDK (e.g. for skill prompt
 * expansions) and must not be re-emitted to the UI.
 */
export function isSyntheticUserMessage(
  msg: SDKMessage,
): msg is SDKMessage & { isSynthetic: boolean } {
  return "isSynthetic" in msg && (msg as { isSynthetic?: unknown }).isSynthetic === true;
}

/** Anthropic API text content block: `{ type: "text", text: string }`. */
export function isTextContentBlock(block: unknown): block is { type: "text"; text: string } {
  return (
    block != null &&
    typeof block === "object" &&
    "type" in block &&
    (block as { type: unknown }).type === "text" &&
    "text" in block &&
    typeof (block as { text: unknown }).text === "string"
  );
}

/** Anthropic API image content block: `{ type: "image", source: ..., filename?: string }`. */
export interface ImageContentBlock {
  type: "image";
  source: {
    type: string;
    media_type?: string;
    data?: string;
    url?: string;
  };
  filename?: string;
}

export function isImageContentBlock(block: unknown): block is ImageContentBlock {
  if (block == null || typeof block !== "object") return false;
  const b = block as { type?: unknown; source?: unknown };
  return b.type === "image" && b.source != null && typeof b.source === "object";
}

/** A base64-encoded image source: used by SDK content blocks. */
export function isBase64ImageSource(
  source: ImageContentBlock["source"],
): source is { type: "base64"; media_type?: string; data: string } {
  return source.type === "base64" && typeof source.data === "string" && source.data.length > 0;
}

/** A URL image source: used by remote-fetched image content. */
export function isUrlImageSource(
  source: ImageContentBlock["source"],
): source is { type: "url"; media_type?: string; url: string } {
  return source.type === "url" && typeof source.url === "string" && source.url.length > 0;
}

/**
 * Tool result envelope `{ result: string }` — emitted by SDK tool calls
 * whose payload normalizes to `{result: "<text>"}` instead of an
 * Anthropic-style content array.
 */
export function isStringResultObject(result: unknown): result is { result: string } {
  return (
    result != null &&
    typeof result === "object" &&
    "result" in result &&
    typeof (result as { result: unknown }).result === "string"
  );
}
