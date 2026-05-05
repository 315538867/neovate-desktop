/**
 * Stream-event handlers for the SDK→UI message transformer.
 *
 * The Anthropic stream protocol is a small state machine: `message_start`
 * → `content_block_*` → `message_stop`. This module owns the dispatch
 * for those events and the per-block bookkeeping. Behavior must remain
 * bit-for-bit identical to the inlined versions — pure relocation, not
 * a redesign.
 *
 * Pulled out of `SDKMessageTransformer` to keep that class focused on
 * the cross-event router. Handlers depend on the parent transformer via
 * a `StreamHandlerContext` bundle that shares mutable state by reference:
 * primitive scalars are bundled into a `StreamState` object, while
 * Set/Map fields can be shared directly.
 */

import type { SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  BetaRawContentBlockDeltaEvent,
  BetaRawContentBlockStartEvent,
  BetaRawContentBlockStopEvent,
  BetaRawMessageStartEvent,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.mjs";

import type { ClaudeCodeUIMessageChunk } from "../../../../shared/claude-code/types";

import { claudeCodeMetadata, isTopLevelParent, reasoningPartId, textPartId } from "./parts-builder";
import { CONTENT_OUTPUT_TOOL_NAMES } from "./tool-output-fallback";

/** Per-block state tracked across `content_block_start` / `_delta` / `_stop`. */
export type ActiveContentBlock =
  | { type: "text"; id: string }
  | { type: "reasoning"; id: string }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      input: string;
      providerExecuted: true;
      providerMetadata?: ReturnType<typeof claudeCodeMetadata>;
    };

/**
 * Mutable scalar state shared between the parent transformer's `transform`
 * router and the stream-handlers in this module. Bundled into a single
 * object so handlers can mutate primitives by reference.
 */
export interface StreamState {
  inStep: boolean;
  hasStarted: boolean;
  currentMessageId: string | null;
  activeStreamedMessageId: string | null;
  currentParentToolUseId: string | null;
  currentStreamHasUnsupportedBlocks: boolean;
}

export function createStreamState(): StreamState {
  return {
    inStep: false,
    hasStarted: false,
    currentMessageId: null,
    activeStreamedMessageId: null,
    currentParentToolUseId: null,
    currentStreamHasUnsupportedBlocks: false,
  };
}

/**
 * Bundle of references the stream-handlers need from the parent
 * transformer. Sets/Maps are shared by reference; primitive scalars
 * live in `state` so mutations propagate back to the parent.
 */
export interface StreamHandlerContext {
  state: StreamState;
  contentBlocks: Map<number, ActiveContentBlock>;
  completedStreamedAssistantMessageIds: Set<string>;
  toolNames: Map<string, string>;
  contentOutputTools: Set<string>;
  rootParentToolUseId: string | null;
  rememberAgentToolPrompt: (toolCallId: string, toolName: string, input: unknown) => void;
}

/** Public entry point used by the parent transformer's `transform` router. */
export function* transformStreamEvent(
  ctx: StreamHandlerContext,
  msg: SDKPartialAssistantMessage,
): Generator<ClaudeCodeUIMessageChunk> {
  switch (msg.event.type) {
    case "message_start": {
      yield* handleMessageStart(ctx, msg, msg.event as BetaRawMessageStartEvent);
      break;
    }

    case "content_block_start": {
      yield* handleContentBlockStart(ctx, msg.event);
      break;
    }

    case "content_block_delta": {
      yield* handleContentBlockDelta(ctx, msg.event);
      break;
    }

    case "content_block_stop": {
      yield* handleContentBlockStop(ctx, msg.event);
      break;
    }

    case "message_stop": {
      yield* handleMessageStop(ctx);
      break;
    }

    case "message_delta": {
      break;
    }
  }
}

// oxlint-disable-next-line require-yield -- caller uses yield*; keeping as generator for symmetry with sibling handlers
function* handleMessageStop(ctx: StreamHandlerContext): Generator<ClaudeCodeUIMessageChunk> {
  if (ctx.state.currentMessageId != null && !ctx.state.currentStreamHasUnsupportedBlocks) {
    ctx.completedStreamedAssistantMessageIds.add(ctx.state.currentMessageId);
  }
  ctx.state.activeStreamedMessageId = null;
}

function* handleMessageStart(
  ctx: StreamHandlerContext,
  msg: SDKPartialAssistantMessage,
  event: BetaRawMessageStartEvent,
): Generator<ClaudeCodeUIMessageChunk> {
  if (!ctx.state.hasStarted) {
    ctx.state.hasStarted = true;
    yield {
      type: "start",
      messageId: event.message.id,
      messageMetadata: {
        sessionId: msg.session_id ?? "",
        parentToolUseId: isTopLevelParent(msg.parent_tool_use_id, ctx.rootParentToolUseId)
          ? null
          : msg.parent_tool_use_id,
      },
    };
  }

  const isNewStep = event.message.id !== ctx.state.currentMessageId;
  if (isNewStep && isTopLevelParent(msg.parent_tool_use_id, ctx.rootParentToolUseId)) {
    if (ctx.state.inStep) {
      yield { type: "finish-step" };
    }
    yield { type: "start-step" };
    ctx.state.inStep = true;
    ctx.state.currentMessageId = event.message.id;
    ctx.contentBlocks.clear();
  }

  ctx.state.currentParentToolUseId = isTopLevelParent(
    msg.parent_tool_use_id,
    ctx.rootParentToolUseId,
  )
    ? null
    : msg.parent_tool_use_id;
  ctx.state.currentStreamHasUnsupportedBlocks = false;
  ctx.state.activeStreamedMessageId = event.message.id;
}

function* handleContentBlockStart(
  ctx: StreamHandlerContext,
  event: BetaRawContentBlockStartEvent,
): Generator<ClaudeCodeUIMessageChunk> {
  if (ctx.state.currentMessageId == null || ctx.contentBlocks.has(event.index)) {
    return;
  }

  switch (event.content_block.type) {
    case "text": {
      const partId = textPartId(ctx.state.currentMessageId, event.index);
      ctx.contentBlocks.set(event.index, { type: "text", id: partId });
      yield { type: "text-start", id: partId };
      return;
    }

    case "thinking": {
      const partId = reasoningPartId(ctx.state.currentMessageId, event.index);
      ctx.contentBlocks.set(event.index, { type: "reasoning", id: partId });
      yield { type: "reasoning-start", id: partId };
      return;
    }

    case "redacted_thinking": {
      const partId = reasoningPartId(ctx.state.currentMessageId, event.index);
      ctx.contentBlocks.set(event.index, { type: "reasoning", id: partId });
      yield {
        type: "reasoning-start",
        id: partId,
        providerMetadata: { anthropic: { redactedData: event.content_block.data } },
      };
      return;
    }

    case "tool_use": {
      yield* handleToolUseBlockStart(ctx, event.content_block, event.index);
      return;
    }

    default: {
      ctx.state.currentStreamHasUnsupportedBlocks = true;
      return;
    }
  }
}

function* handleToolUseBlockStart(
  ctx: StreamHandlerContext,
  contentBlock: BetaToolUseBlock,
  index: number,
): Generator<ClaudeCodeUIMessageChunk> {
  const initialInput =
    contentBlock.input != null &&
    typeof contentBlock.input === "object" &&
    Object.keys(contentBlock.input).length > 0
      ? JSON.stringify(contentBlock.input)
      : "";

  const providerMetadata = claudeCodeMetadata(
    ctx.state.currentParentToolUseId,
    ctx.rootParentToolUseId,
  );
  ctx.contentBlocks.set(index, {
    type: "tool-call",
    toolCallId: contentBlock.id,
    toolName: contentBlock.name,
    input: initialInput,
    providerExecuted: true,
    ...(providerMetadata != null ? { providerMetadata } : {}),
  });

  yield {
    type: "tool-input-start",
    toolCallId: contentBlock.id,
    toolName: contentBlock.name,
    providerExecuted: true,
    ...(providerMetadata != null ? { providerMetadata } : {}),
  };
}

function* handleContentBlockDelta(
  ctx: StreamHandlerContext,
  event: BetaRawContentBlockDeltaEvent,
): Generator<ClaudeCodeUIMessageChunk> {
  const contentBlock = ctx.contentBlocks.get(event.index);
  if (contentBlock == null) {
    return;
  }

  switch (event.delta.type) {
    case "text_delta": {
      if (contentBlock.type !== "text" || event.delta.text.length === 0) {
        return;
      }

      yield { type: "text-delta", id: contentBlock.id, delta: event.delta.text };
      return;
    }

    case "thinking_delta": {
      if (contentBlock.type !== "reasoning") {
        return;
      }

      yield { type: "reasoning-delta", id: contentBlock.id, delta: event.delta.thinking };
      return;
    }

    case "signature_delta": {
      if (contentBlock.type !== "reasoning") {
        return;
      }

      yield {
        type: "reasoning-delta",
        id: contentBlock.id,
        delta: "",
        providerMetadata: { anthropic: { signature: event.delta.signature } },
      };
      return;
    }

    case "input_json_delta": {
      if (contentBlock.type !== "tool-call" || event.delta.partial_json.length === 0) {
        return;
      }

      yield {
        type: "tool-input-delta",
        toolCallId: contentBlock.toolCallId,
        inputTextDelta: event.delta.partial_json,
      };
      contentBlock.input += event.delta.partial_json;
      return;
    }
  }
}

function* handleContentBlockStop(
  ctx: StreamHandlerContext,
  event: BetaRawContentBlockStopEvent,
): Generator<ClaudeCodeUIMessageChunk> {
  const contentBlock = ctx.contentBlocks.get(event.index);
  if (contentBlock == null) {
    return;
  }

  ctx.contentBlocks.delete(event.index);
  switch (contentBlock.type) {
    case "text": {
      yield { type: "text-end", id: contentBlock.id };
      return;
    }
    case "reasoning": {
      yield { type: "reasoning-end", id: contentBlock.id };
      return;
    }
    case "tool-call": {
      const finalInput = contentBlock.input === "" ? "{}" : contentBlock.input;

      try {
        const parsedInput = JSON.parse(finalInput);
        ctx.rememberAgentToolPrompt(contentBlock.toolCallId, contentBlock.toolName, parsedInput);
        ctx.toolNames.set(contentBlock.toolCallId, contentBlock.toolName);
        if (CONTENT_OUTPUT_TOOL_NAMES.has(contentBlock.toolName)) {
          ctx.contentOutputTools.add(contentBlock.toolCallId);
        }
        yield {
          type: "tool-input-available",
          toolCallId: contentBlock.toolCallId,
          toolName: contentBlock.toolName,
          input: parsedInput,
          providerExecuted: contentBlock.providerExecuted,
          ...(contentBlock.providerMetadata != null
            ? { providerMetadata: contentBlock.providerMetadata }
            : {}),
        };
      } catch (error) {
        yield {
          type: "tool-input-error",
          toolCallId: contentBlock.toolCallId,
          toolName: contentBlock.toolName,
          input: finalInput,
          errorText: error instanceof Error ? error.message : "Invalid tool input JSON",
          providerExecuted: contentBlock.providerExecuted,
          ...(contentBlock.providerMetadata != null
            ? { providerMetadata: contentBlock.providerMetadata }
            : {}),
        };
      }
      return;
    }
  }
}
