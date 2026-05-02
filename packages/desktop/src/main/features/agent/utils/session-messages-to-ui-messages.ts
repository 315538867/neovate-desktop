import type { SDKMessage, SessionMessage } from "@anthropic-ai/claude-agent-sdk";

import debug from "debug";

import type { ClaudeCodeUIMessage } from "../../../../shared/claude-code/types";

import { sdkMessagesToUIMessage } from "./sdk-messages-to-ui-message";

const log = debug("neovate:session-messages");

/**
 * Raw session message shape including fields that the upstream SDK type
 * declaration omits but appear at runtime in the on-disk `.jsonl` files.
 *
 * Field names differ between SDK type (snake_case) and on-disk jsonl
 * (camelCase) — declare both for robust read access.
 */
type RawSessionMessage = SDKMessage & {
  isCompactSummary?: boolean;
  message?: { content?: unknown };
  compact_metadata?: Record<string, unknown>;
  compactMetadata?: Record<string, unknown>;
  uuid?: string;
};

type CompactSummaryPart = Extract<
  ClaudeCodeUIMessage["parts"][number],
  { type: "data-compact-summary" }
>;

function countMessageTypes(messages: SDKMessage[]) {
  const counts = new Map<string, number>();

  for (const message of messages) {
    const key =
      message.type === "system"
        ? `${message.type}:${message.subtype}`
        : message.type === "result"
          ? `${message.type}:${message.subtype}`
          : message.type;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Object.fromEntries(counts);
}

function extractSummaryText(msg: RawSessionMessage | undefined): string {
  if (msg == null) return "";
  const content = msg.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { type: string; text?: string }) => b.text ?? "")
      .join("");
  }
  return "";
}

/**
 * Synthesize a single system UI message representing a compact boundary
 * by merging the boundary message with the immediately following
 * `isCompactSummary: true` user message (which carries the summary text).
 */
function buildCompactSummaryMessage(
  boundary: RawSessionMessage,
  next: RawSessionMessage | undefined,
): { uiMessage: ClaudeCodeUIMessage; consumedNext: boolean } {
  const cm = (boundary.compact_metadata ?? boundary.compactMetadata ?? {}) as Record<
    string,
    unknown
  >;
  const trigger = (cm.trigger as "manual" | "auto") ?? "auto";
  const preTokens = Number(cm.pre_tokens ?? cm.preTokens ?? 0);
  const postTokensRaw = cm.post_tokens ?? cm.postTokens;
  const durationRaw = cm.duration_ms ?? cm.durationMs;

  const nextIsSummary = next != null && next.type === "user" && next.isCompactSummary === true;
  const summaryRaw = nextIsSummary ? extractSummaryText(next) : "";

  const sessionId = (boundary as { session_id?: string }).session_id ?? "";
  const uuid = boundary.uuid ?? crypto.randomUUID();

  const part: CompactSummaryPart = {
    type: "data-compact-summary",
    data: {
      trigger,
      preTokens,
      ...(postTokensRaw != null ? { postTokens: Number(postTokensRaw) } : {}),
      ...(durationRaw != null ? { durationMs: Number(durationRaw) } : {}),
      summaryRaw,
    },
  };

  return {
    uiMessage: {
      id: uuid,
      role: "system",
      parts: [part],
      metadata: {
        deliveryMode: "restored",
        sessionId,
        parentToolUseId: null,
      },
    } as ClaudeCodeUIMessage,
    consumedNext: nextIsSummary,
  };
}

/**
 * Convert raw SDK session messages into UI messages.
 * Human prompts become user messages; assistant/tool_result batches
 * are replayed through the AI SDK stream protocol.
 *
 * Accepts SessionMessage[] (from getSessionMessages) — cast internally
 * to SDKMessage[] since the runtime data includes system/result types
 * that the SessionMessage type declaration doesn't cover.
 */
export async function sessionMessagesToUIMessages(
  sessionMessages: SessionMessage[],
): Promise<ClaudeCodeUIMessage[]> {
  log("START count=%d", sessionMessages.length);
  const results: ClaudeCodeUIMessage[] = [];
  let batch: SDKMessage[] = [];
  const messages = sessionMessages as unknown as RawSessionMessage[];

  const rawMessageTypes = countMessageTypes(messages as SDKMessage[]);
  log("RAW messageTypes=%O", rawMessageTypes);

  const flushBatch = async () => {
    if (batch.length === 0) return;
    const batchCopy = batch;
    batch = [];
    const batchTypes = batchCopy.map((message) =>
      message.type === "system" || message.type === "result"
        ? `${message.type}:${message.subtype}`
        : message.type,
    );
    log("FLUSH batchSize=%d batchTypes=%O", batchCopy.length, batchTypes);
    const last = await sdkMessagesToUIMessage(batchCopy);
    if (last) {
      last.metadata = {
        deliveryMode: "restored",
        parentToolUseId: last.metadata?.parentToolUseId ?? null,
        sessionId: last.metadata?.sessionId ?? batchCopy[0]?.session_id ?? "",
      };
      log(
        "FLUSH result messageId=%s role=%s partTypes=%O",
        last.id,
        last.role,
        last.parts.map((part) => part.type),
      );
      results.push(last);
    } else {
      log("FLUSH result=<empty>");
    }
  };

  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];

    // Handle compact boundary: merge with the immediately following
    // user message (which carries `isCompactSummary: true` and the actual
    // summary text) into a single synthesized system UI message.
    if (msg.type === "system" && (msg as { subtype?: string }).subtype === "compact_boundary") {
      await flushBatch();
      const { uiMessage, consumedNext } = buildCompactSummaryMessage(msg, messages[i + 1]);
      results.push(uiMessage);
      if (consumedNext) i += 1;
      continue;
    }

    // Skip messages that don't contribute to UIMessage content
    if (msg.type === "system" && msg.subtype !== "init") continue;
    if (msg.type === "result") continue;

    if (msg.type !== "user" && msg.type !== "assistant" && msg.type !== "system") {
      continue;
    }

    if (msg.type !== "user") {
      batch.push(msg);
      continue;
    }

    // Defensive: a stray isCompactSummary user message without a preceding
    // compact_boundary should not be rendered as a normal user prompt.
    if (msg.isCompactSummary === true) {
      continue;
    }

    const content = msg.message?.content;
    const isToolResultMessage =
      Array.isArray(content) && content.some((p: { type: string }) => p.type === "tool_result");
    const isHumanTextPrompt = typeof content === "string";
    const isHumanArrayPrompt =
      Array.isArray(content) &&
      content.some((b: { type: string }) => b.type === "text" || b.type === "image");
    const isHumanPrompt = !isToolResultMessage && (isHumanTextPrompt || isHumanArrayPrompt);

    if (isHumanPrompt) {
      await flushBatch();
      const parts: ClaudeCodeUIMessage["parts"] = [];

      if (typeof content === "string") {
        parts.push({
          type: "text",
          text: content,
          state: "done",
        } as ClaudeCodeUIMessage["parts"][number]);
      } else if (Array.isArray(content)) {
        const textStr = content
          .filter((b: { type: string }) => b.type === "text")
          .map((b: { type: string; text?: string }) => b.text ?? "")
          .join("");
        if (textStr) {
          parts.push({
            type: "text",
            text: textStr,
            state: "done",
          } as ClaudeCodeUIMessage["parts"][number]);
        }
        for (const b of content) {
          const block = b as {
            type: string;
            source?: { type: string; media_type?: string; data?: string };
          };
          if (block.type === "image" && block.source?.type === "base64") {
            const mediaType = block.source.media_type ?? "image/png";
            parts.push({
              type: "file",
              mediaType,
              url: `data:${mediaType};base64,${block.source.data}`,
            } as ClaudeCodeUIMessage["parts"][number]);
          }
        }
      }

      if (parts.length === 0) {
        parts.push({
          type: "text",
          text: typeof content === "string" ? content : "",
          state: "done",
        } as ClaudeCodeUIMessage["parts"][number]);
      }

      results.push({
        id: msg.uuid ?? crypto.randomUUID(),
        role: "user",
        parts,
        metadata: {
          deliveryMode: "restored",
          sessionId: (msg as SDKMessage).session_id,
          parentToolUseId: null,
        },
      } as ClaudeCodeUIMessage);
    } else {
      batch.push(msg as SDKMessage);
    }
  }

  await flushBatch();
  log("DONE results=%d", results.length);
  return results;
}
