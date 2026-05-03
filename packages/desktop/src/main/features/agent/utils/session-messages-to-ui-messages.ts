import type { SDKMessage, SessionMessage } from "@anthropic-ai/claude-agent-sdk";

import debug from "debug";

import type { ClaudeCodeUIMessage } from "../../../../shared/claude-code/types";

import { parseCliUserContent } from "../../../../shared/claude-code/parse-cli-user-content";
import { extractTextFromUserContent, isCompactSummaryText } from "./compact-detection";
import {
  readCompactMetaFromJsonl,
  parseCompactMeta,
  type CompactMeta,
} from "./read-jsonl-compact-meta";
import { sdkMessagesToUIMessage } from "./sdk-messages-to-ui-message";

const log = debug("neovate:session-messages");

/**
 * Raw session message shape including fields that the upstream SDK type
 * declaration omits but may appear at runtime. Field names differ between
 * SDK type (snake_case) and on-disk jsonl (camelCase) — we read both.
 *
 * Note: in SDK v0.2.108, the SDK strips `isCompactSummary` from the user
 * message before returning it, so the field is included here only as a
 * defensive read for future SDK versions that may restore it.
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

const FALLBACK_META: CompactMeta = { trigger: "auto", preTokens: 0 };

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

/**
 * Synthesize a single system UI message representing a compact boundary.
 * `summaryRaw` may come from either an embedded boundary message or a
 * standalone compact-summary user message.
 */
function buildCompactSummaryMessage(args: {
  summaryRaw: string;
  meta: CompactMeta;
  sessionId: string;
  uuid: string;
}): ClaudeCodeUIMessage {
  const { summaryRaw, meta, sessionId, uuid } = args;
  const part: CompactSummaryPart = {
    type: "data-compact-summary",
    data: {
      trigger: meta.trigger,
      preTokens: meta.preTokens,
      ...(meta.postTokens != null ? { postTokens: meta.postTokens } : {}),
      ...(meta.durationMs != null ? { durationMs: meta.durationMs } : {}),
      summaryRaw,
    },
  };

  return {
    id: uuid,
    role: "system",
    parts: [part],
    metadata: {
      deliveryMode: "restored",
      sessionId,
      parentToolUseId: null,
    },
  } as ClaudeCodeUIMessage;
}

/**
 * Convert raw SDK session messages into UI messages.
 * Human prompts become user messages; assistant/tool_result batches
 * are replayed through the AI SDK stream protocol.
 *
 * Compact handling: SDK strips boundary markers, so we (a) detect
 * synthetic compact-summary user messages by their fixed text prefix,
 * and (b) read the original `.jsonl` to recover compact metadata
 * (trigger / preTokens / postTokens / durationMs) in document order.
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

  // Recover compact metadata from disk in parallel-friendly order. We use the
  // session_id from the first message that carries one (system/init typically
  // does). If we can't find one, metas is empty and we fall back to defaults.
  const sessionIdForMeta =
    (
      messages.find((m) => (m as { session_id?: string }).session_id) as
        | { session_id?: string }
        | undefined
    )?.session_id ?? "";
  const metas = sessionIdForMeta
    ? await readCompactMetaFromJsonl(sessionIdForMeta).catch(() => [] as CompactMeta[])
    : ([] as CompactMeta[]);
  let metaCursor = 0;
  const consumeMeta = (): CompactMeta => metas[metaCursor++] ?? FALLBACK_META;

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

  const emitCompactSummary = async (summaryRaw: string, sessionId: string, uuid: string) => {
    await flushBatch();
    results.push(
      buildCompactSummaryMessage({
        summaryRaw,
        meta: consumeMeta(),
        sessionId,
        uuid,
      }),
    );
  };

  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];

    // Legacy / future-compat path: if SDK actually returns a `compact_boundary`
    // system message, consume it together with the following compact-summary
    // user message (if present). This branch is currently dormant on
    // SDK v0.2.108 but kept for forward compatibility.
    if (msg.type === "system" && (msg as { subtype?: string }).subtype === "compact_boundary") {
      const next = messages[i + 1];
      const nextText =
        next != null && next.type === "user"
          ? extractTextFromUserContent(next.message?.content)
          : "";
      const isAdjacentSummary =
        next != null &&
        next.type === "user" &&
        ((next as { isCompactSummary?: boolean }).isCompactSummary === true ||
          isCompactSummaryText(nextText));
      const summaryRaw = isAdjacentSummary ? nextText : "";
      await flushBatch();
      results.push(
        buildCompactSummaryMessage({
          summaryRaw,
          meta: parseCompactMeta(msg.compact_metadata ?? msg.compactMetadata) ?? consumeMeta(),
          sessionId: (msg as { session_id?: string }).session_id ?? "",
          uuid: msg.uuid ?? crypto.randomUUID(),
        }),
      );
      if (isAdjacentSummary) i += 1;
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

    const content = msg.message?.content;

    // Detect the auto-injected compact-summary user message — either by the
    // (rare, SDK-stripped) `isCompactSummary` flag or by its fixed text prefix.
    const userText = extractTextFromUserContent(content);
    if (msg.isCompactSummary === true || isCompactSummaryText(userText)) {
      await emitCompactSummary(
        userText,
        (msg as SDKMessage).session_id ?? "",
        msg.uuid ?? crypto.randomUUID(),
      );
      continue;
    }

    const isToolResultMessage =
      Array.isArray(content) && content.some((p: { type: string }) => p.type === "tool_result");
    const isHumanTextPrompt = typeof content === "string";
    const isHumanArrayPrompt =
      Array.isArray(content) &&
      content.some((b: { type: string }) => b.type === "text" || b.type === "image");
    const isHumanPrompt = !isToolResultMessage && (isHumanTextPrompt || isHumanArrayPrompt);

    if (isHumanPrompt) {
      await flushBatch();
      // Translate the CLI's external protocol (raw text plus private XML
      // envelopes for slash commands) into our internal domain model so
      // downstream renderers never deal with raw `<command-*>` tags.
      const parsed = parseCliUserContent(content);
      const parts: ClaudeCodeUIMessage["parts"] =
        parsed.parts.length > 0
          ? (parsed.parts as ClaudeCodeUIMessage["parts"])
          : ([
              {
                type: "text",
                text: typeof content === "string" ? content : "",
                state: "done",
              },
            ] as ClaudeCodeUIMessage["parts"]);

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
  log("DONE results=%d compactMetas=%d/%d", results.length, metaCursor, metas.length);
  return results;
}
