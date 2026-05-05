/**
 * Aggregator for parent-tool sub-conversations (Task / Agent tools).
 *
 * When the assistant calls a Task or Agent tool, the SDK emits a sub-stream
 * of child messages tagged with `parent_tool_use_id`. This module routes
 * those child messages into a separate per-tool sub-transformer and emits
 * preliminary `tool-output-available` chunks while the sub-conversation is
 * still in flight, before finalizing with the actual `tool_result` content.
 *
 * Pulled out of `SDKMessageTransformer` to keep that class focused on the
 * streaming state machine. The aggregator depends on the parent transformer
 * via an `AggregatorContext` bundle: the parent owns the state map and the
 * `transform` generator, and supplies a `materializeChild` callback to
 * avoid a circular import on the transformer class itself.
 *
 * Behavior must remain bit-for-bit identical to the inlined versions —
 * pure relocation, not a redesign.
 */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import type {
  ClaudeCodeUIMessage,
  ClaudeCodeUIMessageChunk,
} from "../../../../shared/claude-code/types";

import { finalizeAgentMessage, resultContentToText } from "./parts-builder";
import { isTaskOrAgentTool } from "./type-guards";

/**
 * Per-parent-tool aggregation state, owned by the parent transformer's
 * `activeParentTools` map. We keep `childMessages` so we can fully
 * re-materialize the sub-conversation on every new child message — this
 * matches the original behavior and trades O(n²) work for idempotency.
 */
export type ParentToolState = {
  toolName: "Task" | "Agent";
  prompt?: string;
  childMessages: SDKMessage[];
  latestMessage?: ClaudeCodeUIMessage;
};

/**
 * Bundle of references the aggregator needs from the parent transformer.
 * The transformer class implements this with `this.activeParentTools`,
 * `this.transform.bind(this)`, and a closure that constructs a fresh
 * sub-transformer for each child-message materialization.
 */
export interface AggregatorContext {
  activeParentTools: Map<string, ParentToolState>;
  transform: (msg: SDKMessage) => Generator<ClaudeCodeUIMessageChunk>;
  /**
   * Materialize the accumulated child messages into a single UI message.
   * Called on every new child message, so the impl must construct a fresh
   * sub-transformer each time to keep replay deterministic.
   */
  materializeChild: (
    childMessages: SDKMessage[],
    parentToolUseId: string,
    prompt: string | null,
  ) => Promise<ClaudeCodeUIMessage | undefined>;
}

/**
 * Public entry point used by `materializeSDKMessagesToUIMessage`. Routes
 * messages either into the active parent-tool's sub-conversation (when
 * tagged) or through the parent transformer's normal `transform`, with
 * post-processing to convert `tool-output-*` chunks into the aggregated
 * agent-message envelope.
 */
export async function* transformWithAggregation(
  ctx: AggregatorContext,
  msg: SDKMessage,
): AsyncGenerator<ClaudeCodeUIMessageChunk> {
  const parentToolUseId = "parent_tool_use_id" in msg ? msg.parent_tool_use_id : null;

  if (parentToolUseId != null && ctx.activeParentTools.has(parentToolUseId)) {
    yield* handleChildMessage(ctx, parentToolUseId, msg);
    return;
  }

  const parentToolResults = parentToolResultsForMessage(ctx, msg);
  for (const chunk of ctx.transform(msg)) {
    if (chunk.type === "tool-input-available" && isTaskOrAgentTool(chunk.toolName)) {
      ctx.activeParentTools.set(chunk.toolCallId, {
        toolName: chunk.toolName,
        prompt: extractToolPrompt(chunk.input),
        childMessages: [],
      });
      yield chunk;
      continue;
    }

    if (
      (chunk.type === "tool-output-available" || chunk.type === "tool-output-error") &&
      parentToolResults.has(chunk.toolCallId)
    ) {
      const state = ctx.activeParentTools.get(chunk.toolCallId);
      const toolResult = parentToolResults.get(chunk.toolCallId);
      if (state == null || toolResult == null) {
        yield chunk;
        continue;
      }

      if (toolResult.is_error) {
        yield {
          type: "tool-output-error",
          toolCallId: chunk.toolCallId,
          errorText: resultContentToText(toolResult.content, true),
          providerExecuted: true,
        };
      } else {
        state.latestMessage = finalizeAgentMessage({
          toolCallId: chunk.toolCallId,
          sessionId: msg.session_id ?? "",
          baseMessage: state.latestMessage,
          result: toolResult.content,
          isError: false,
        });

        yield {
          type: "tool-output-available",
          toolCallId: chunk.toolCallId,
          output: state.latestMessage,
          providerExecuted: true,
          preliminary: false,
        };
      }
      ctx.activeParentTools.delete(chunk.toolCallId);
      continue;
    }

    yield chunk;
  }
}

/**
 * Stash the child message and emit a preliminary `tool-output-available`
 * with the in-flight sub-conversation's UI message. The final non-
 * preliminary chunk is emitted by the parent path once the actual
 * `tool_result` arrives.
 */
async function* handleChildMessage(
  ctx: AggregatorContext,
  parentToolUseId: string,
  msg: SDKMessage,
): AsyncGenerator<ClaudeCodeUIMessageChunk> {
  const state = ctx.activeParentTools.get(parentToolUseId);
  if (state == null) {
    return;
  }

  state.childMessages.push(msg);
  state.latestMessage = await ctx.materializeChild(
    state.childMessages,
    parentToolUseId,
    state.prompt ?? null,
  );

  if (state.latestMessage == null) {
    return;
  }

  yield {
    type: "tool-output-available",
    toolCallId: parentToolUseId,
    output: state.latestMessage,
    providerExecuted: true,
    preliminary: true,
  };
}

/**
 * Collect all `tool_result` content blocks in this user message that
 * point at currently-active parent tools — these are the final results
 * we need to splice back into the parent's UI message.
 */
function parentToolResultsForMessage(ctx: AggregatorContext, msg: SDKMessage) {
  const parentToolResults = new Map<string, { content: unknown; is_error: boolean }>();

  if (msg.type !== "user" || !Array.isArray(msg.message.content)) {
    return parentToolResults;
  }

  for (const part of msg.message.content) {
    if (part.type !== "tool_result") continue;
    if (!ctx.activeParentTools.has(part.tool_use_id)) continue;
    parentToolResults.set(part.tool_use_id, {
      content: part.content,
      is_error: part.is_error === true,
    });
  }

  return parentToolResults;
}

/**
 * Read the `prompt` string off an Agent/Task tool input. Returns
 * `undefined` for inputs without a string `prompt` field.
 */
export function extractToolPrompt(input: unknown) {
  if (
    input != null &&
    typeof input === "object" &&
    "prompt" in input &&
    typeof input.prompt === "string"
  ) {
    return input.prompt;
  }

  return undefined;
}
