/**
 * Session subscriber loop.
 *
 * The long-lived background coroutine that consumes the SDK query iterator
 * and publishes every side event and chunk to the per-session event channel.
 * Pulled out of `SessionManager.consume` so the manager class stays focused
 * on orchestration. Behavior is bit-for-bit identical to the inlined
 * version — this is a pure relocation, not a redesign.
 *
 * Started fire-and-forget after `initSession()`; intentionally does NOT
 * break on `result` — the SDK keeps emitting through background turns.
 */

import type { EventPublisher } from "@orpc/server";

import { randomUUID } from "node:crypto";

import type {
  ClaudeCodeUIEvent,
  ClaudeCodeUIMessageChunk,
} from "../../../../shared/claude-code/types";
import type { PowerBlockerService } from "../../../core/power-blocker-service";
import type { SessionEntry } from "./types";

import { lookupContextWindow } from "../../../../shared/claude-code/model-context-windows";
import { SDKMessageTransformer, toUIEvent } from "../sdk-message-transformer";

/**
 * Consume the query iterator for one session, publishing events/chunks
 * through `eventPublisher` and tracking context-window usage on each
 * `result`. Resolves when the iterator is exhausted or errors.
 */
export async function consumeSession(opts: {
  sessionId: string;
  session: SessionEntry;
  eventPublisher: EventPublisher<Record<string, ClaudeCodeUIEvent>>;
  powerBlocker: PowerBlockerService;
}): Promise<void> {
  const { sessionId, session, eventPublisher, powerBlocker } = opts;
  const transformer = new SDKMessageTransformer();

  // Track the latest top-level message_start usage to compute context window fill
  let lastInputTokens = 0;

  try {
    while (true) {
      const { value, done } = await session.query.next();
      if (done || !value) break;

      // Track context window usage from top-level message_start events
      if (
        value.type === "stream_event" &&
        value.event.type === "message_start" &&
        value.parent_tool_use_id === null
      ) {
        // Non-Anthropic providers (e.g. Wohu/Kimi) may omit usage from message_start
        const usage = value.event.message.usage;
        if (usage) {
          lastInputTokens =
            (usage.input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0);
        }
      }

      // Publish side events to subscribe stream (result event included — carries cost/usage/stop_reason)
      const event = toUIEvent(value);
      if (event) {
        eventPublisher.publish(sessionId, event);
      }

      // On result, publish context_usage event with computed remaining %
      if (value.type === "result") {
        const modelEntries = Object.values(value.modelUsage ?? {});
        const modelUsage = modelEntries[0];

        if (session.providerId) {
          // Third-party provider: contextWindow is unreliable (SDK defaults to 200k).
          // Publish cumulative input/output tokens from the API response instead.
          eventPublisher.publish(sessionId, {
            kind: "event",
            event: {
              id: randomUUID(),
              type: "context_usage",
              contextWindowSize: 0,
              usedTokens: 0,
              remainingPct: 0,
              totalInputTokens: modelUsage?.inputTokens ?? 0,
              totalOutputTokens: modelUsage?.outputTokens ?? 0,
            },
          });
        } else {
          let contextWindowSize = modelUsage?.contextWindow ?? 0;
          if (!contextWindowSize) {
            // Non-Anthropic providers often omit contextWindow; fall back to a known map.
            contextWindowSize = lookupContextWindow(session.model);
          }
          const remainingPct =
            contextWindowSize > 0
              ? Math.max(
                  0,
                  Math.min(100, Math.round((1 - lastInputTokens / contextWindowSize) * 100)),
                )
              : 0;
          eventPublisher.publish(sessionId, {
            kind: "event",
            event: {
              id: randomUUID(),
              type: "context_usage",
              contextWindowSize,
              usedTokens: lastInputTokens,
              remainingPct,
            },
          });
        }
        powerBlocker.onTurnEnd(sessionId);
      }

      // Publish chunks through eventPublisher (wrapped as { kind: "chunk", chunk })
      for await (const chunk of transformer.transformWithAggregation(value)) {
        eventPublisher.publish(sessionId, { kind: "chunk", chunk });
      }

      // NO break on result — continue processing background turns
    }
  } catch (err: unknown) {
    const errorText = err instanceof Error ? err.message : String(err);
    eventPublisher.publish(sessionId, {
      kind: "chunk",
      chunk: { type: "error", errorText } as ClaudeCodeUIMessageChunk,
    });
  } finally {
    session.consumeExited = true;
    powerBlocker.onTurnEnd(sessionId);
  }
}
