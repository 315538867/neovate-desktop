import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { createUIMessageStream, readUIMessageStream } from "ai";

import type {
  ClaudeCodeUIMessage,
  ClaudeCodeUIMessageChunk,
  ClaudeCodeUIEvent,
} from "../../../shared/claude-code/types";

import {
  type AggregatorContext,
  type ParentToolState,
  transformWithAggregation as runWithAggregation,
} from "./transformer/agent-aggregator";
import {
  claudeCodeMetadata,
  emitParsedUserText,
  isTopLevelParent,
} from "./transformer/parts-builder";
import {
  type ActiveContentBlock,
  createStreamState,
  type StreamHandlerContext,
  type StreamState,
  transformStreamEvent as runTransformStreamEvent,
} from "./transformer/stream-handlers";
import {
  CONTENT_OUTPUT_TOOL_NAMES,
  contentToOutputSchema,
} from "./transformer/tool-output-fallback";
import { isSyntheticUserMessage } from "./transformer/type-guards";

type SDKMessageTransformerOptions = {
  rootParentToolUseId?: string | null;
  rootToolPrompt?: string | null;
};

export class SDKMessageTransformer {
  /** Mutable scalar state shared with `transformer/stream-handlers`. */
  private readonly streamState: StreamState = createStreamState();
  private readonly completedStreamedAssistantMessageIds = new Set<string>();
  // Narrow dedupe state for Agent kickoff prompts only.
  // We intentionally do not scan prior messages or do fuzzy matching here.
  private readonly agentToolPrompts = new Map<string, string>();
  private readonly contentBlocks = new Map<number, ActiveContentBlock>();
  private readonly activeParentTools = new Map<string, ParentToolState>();
  /** Tracks toolCallIds whose output should use raw content instead of tool_use_result. */
  private readonly contentOutputTools = new Set<string>();
  /** Tracks toolCallId → toolName for content-to-outputSchema conversion on restore. */
  private readonly toolNames = new Map<string, string>();
  private readonly rootParentToolUseId: string | null;
  private readonly rootToolPrompt: string | null;

  constructor(options?: SDKMessageTransformerOptions) {
    this.rootParentToolUseId = options?.rootParentToolUseId ?? null;
    this.rootToolPrompt = options?.rootToolPrompt ?? null;
  }

  *transform(msg: SDKMessage): Generator<ClaudeCodeUIMessageChunk> {
    switch (msg.type) {
      case "system": {
        if (msg.subtype === "init") {
          this.streamState.inStep = false;
          this.streamState.hasStarted = true;
          this.streamState.currentMessageId = null;
          this.streamState.activeStreamedMessageId = null;
          this.streamState.currentParentToolUseId = null;
          this.streamState.currentStreamHasUnsupportedBlocks = false;
          this.agentToolPrompts.clear();
          this.activeParentTools.clear();
          yield {
            type: "start",
            messageId: msg.uuid,
            messageMetadata: { sessionId: msg.session_id, parentToolUseId: null },
          };
          yield { type: "data-system/init", data: msg };
        } else if (msg.subtype === "compact_boundary") {
          yield { type: "data-system/compact_boundary", data: msg };
        }
        break;
      }

      case "assistant": {
        if (msg.message.id === this.streamState.activeStreamedMessageId) {
          break;
        }
        if (this.completedStreamedAssistantMessageIds.has(msg.message.id)) {
          break;
        }
        if (!this.streamState.hasStarted) {
          this.streamState.hasStarted = true;
          yield { type: "start", messageId: msg.message.id };
        }
        if (isTopLevelParent(msg.parent_tool_use_id, this.rootParentToolUseId)) {
          const isNewStep = msg.message.id !== this.streamState.currentMessageId;
          if (isNewStep) {
            if (this.streamState.inStep) yield { type: "finish-step" };
            yield { type: "start-step" };
            this.streamState.inStep = true;
            this.streamState.currentMessageId = msg.message.id;
          }
        }
        yield* this.transformAssistant(msg);
        break;
      }

      case "user": {
        // Skip synthetic messages injected by the SDK (e.g. skill prompt expansions)
        if (isSyntheticUserMessage(msg)) break;
        yield* this.transformUser(msg);
        break;
      }

      case "stream_event": {
        yield* runTransformStreamEvent(this.streamHandlerContext(), msg);
        break;
      }

      case "result": {
        if (this.streamState.inStep) yield { type: "finish-step" };

        // aborted_streaming: user sent a new message while the previous turn was still
        // streaming — the SDK aborts the in-flight response. This is expected, not an error.
        const isSuppressed =
          msg.subtype === "error_during_execution" && msg.terminal_reason === "aborted_streaming";
        const isError = msg.subtype !== "success" && !isSuppressed;

        if (isError) {
          yield {
            type: "error",
            errorText: msg.errors.join("\n") || `An unexpected error occurred (${msg.subtype})`,
          };
        }

        yield { type: `data-result/${msg.subtype}`, data: msg } as ClaudeCodeUIMessageChunk;
        yield { type: "finish" };

        this.streamState.inStep = false;
        this.streamState.currentMessageId = null;
        this.streamState.activeStreamedMessageId = null;
        this.streamState.currentParentToolUseId = null;
        this.streamState.currentStreamHasUnsupportedBlocks = false;
        this.agentToolPrompts.clear();
        this.contentBlocks.clear();
        this.activeParentTools.clear();
        break;
      }
    }
  }

  async *transformWithAggregation(msg: SDKMessage): AsyncGenerator<ClaudeCodeUIMessageChunk> {
    yield* runWithAggregation(this.aggregatorContext(), msg);
  }

  /**
   * Bundle the parent-transformer state the aggregator needs. Created
   * fresh on every call (cheap object literal); the underlying state map
   * is shared by reference so accumulation across messages is preserved.
   */
  private aggregatorContext(): AggregatorContext {
    return {
      activeParentTools: this.activeParentTools,
      transform: (m) => this.transform(m),
      materializeChild: (childMessages, parentToolUseId, prompt) =>
        materializeSDKMessagesToUIMessage(childMessages, {
          transformer: new SDKMessageTransformer({
            rootParentToolUseId: parentToolUseId,
            rootToolPrompt: prompt,
          }),
        }),
    };
  }

  /**
   * Bundle the streaming-state and Set/Map references the stream-handlers
   * need. Created fresh on every dispatch (cheap object literal); the
   * `state` object and Set/Map fields are shared by reference so handler
   * mutations propagate back to the parent.
   */
  private streamHandlerContext(): StreamHandlerContext {
    return {
      state: this.streamState,
      contentBlocks: this.contentBlocks,
      completedStreamedAssistantMessageIds: this.completedStreamedAssistantMessageIds,
      toolNames: this.toolNames,
      contentOutputTools: this.contentOutputTools,
      rootParentToolUseId: this.rootParentToolUseId,
      rememberAgentToolPrompt: (toolCallId, toolName, input) =>
        this.rememberAgentToolPrompt(toolCallId, toolName, input),
    };
  }

  private *transformAssistant(
    msg: SDKMessage & { type: "assistant" },
  ): Generator<ClaudeCodeUIMessageChunk> {
    for (const part of msg.message.content) {
      switch (part.type) {
        case "text": {
          yield { type: "text-start", id: msg.message.id };
          yield { type: "text-delta", id: msg.message.id, delta: part.text };
          yield { type: "text-end", id: msg.message.id };
          break;
        }
        case "thinking": {
          yield {
            type: "reasoning-start",
            id: msg.message.id,
            providerMetadata: { anthropic: { signature: part.signature } },
          };
          yield { type: "reasoning-delta", id: msg.message.id, delta: part.thinking };
          yield { type: "reasoning-end", id: msg.message.id };
          break;
        }
        case "redacted_thinking": {
          yield {
            type: "reasoning-start",
            id: msg.message.id,
            providerMetadata: { anthropic: { redactedData: part.data } },
          };
          yield { type: "reasoning-end", id: msg.message.id };
          break;
        }
        case "tool_use": {
          this.rememberAgentToolPrompt(part.id, part.name, part.input);
          this.toolNames.set(part.id, part.name);
          if (CONTENT_OUTPUT_TOOL_NAMES.has(part.name)) {
            this.contentOutputTools.add(part.id);
          }
          yield {
            type: "tool-input-available",
            toolCallId: part.id,
            toolName: part.name,
            input: part.input,
            providerExecuted: true,
            providerMetadata: claudeCodeMetadata(msg.parent_tool_use_id, this.rootParentToolUseId),
          };
          break;
        }
      }
    }
  }

  private *transformUser(msg: SDKMessage & { type: "user" }): Generator<ClaudeCodeUIMessageChunk> {
    const message = msg as any;
    const content = message.message?.content;

    // Translate the CLI's external XML envelope (slash commands) into our
    // internal domain events here, so the live-stream path mirrors the
    // jsonl-restore path. Both inbound paths must produce the same
    // `data-slash-command` parts for downstream consumers.
    if (typeof content === "string") {
      if (this.shouldSkipNestedPromptText(msg.parent_tool_use_id, content)) {
        return;
      }
      yield* emitParsedUserText(content, message.uuid);
      return;
    }

    if (!Array.isArray(content)) return;

    for (const part of content) {
      switch (part.type) {
        case "tool_result": {
          if (part.is_error) {
            yield {
              type: "tool-output-error",
              toolCallId: part.tool_use_id,
              errorText: typeof part.content === "string" ? part.content : "",
              providerExecuted: true,
            };
          } else {
            const output = this.resolveToolOutput(part.tool_use_id, part.content, message);
            yield {
              type: "tool-output-available",
              toolCallId: part.tool_use_id,
              output,
              providerExecuted: true,
            };
          }
          break;
        }
        case "text": {
          if (this.shouldSkipNestedPromptText(msg.parent_tool_use_id, part.text)) {
            break;
          }
          yield* emitParsedUserText(part.text, message.uuid);
          break;
        }
      }
    }
  }

  // Claude Code emits both:
  // 1. the Agent tool input.prompt
  // 2. a subagent user text message with the same content
  //
  // Keep the fix narrow: cache only Agent prompts by toolCallId, then do a
  // single exact-string lookup when a child user message already points to that
  // tool via parent_tool_use_id. No history scans, no normalization, no fuzzy match.
  private rememberAgentToolPrompt(toolCallId: string, toolName: string, input: unknown) {
    if (toolName !== "Agent") {
      return;
    }

    const prompt =
      input != null && typeof input === "object" && "prompt" in input ? input.prompt : undefined;
    if (typeof prompt !== "string" || prompt.length === 0) {
      return;
    }

    this.agentToolPrompts.set(toolCallId, prompt);
  }

  private shouldSkipNestedPromptText(
    parentToolUseId: string | null | undefined,
    text: string | undefined,
  ) {
    if (parentToolUseId == null || typeof text !== "string") {
      return false;
    }

    if (parentToolUseId === this.rootParentToolUseId && this.rootToolPrompt === text) {
      return true;
    }

    const prompt = this.agentToolPrompts.get(parentToolUseId);
    return prompt != null && prompt === text;
  }

  private resolveToolOutput(toolCallId: string, content: unknown, message: any): unknown {
    if (this.contentOutputTools.has(toolCallId)) {
      return content;
    }
    // The SDK may attach the structured result as either snake_case (wire format)
    // or camelCase (JS-normalized). Check both to handle either convention.
    const structured = message.tool_use_result ?? message.toolUseResult;
    if (structured !== undefined) return structured;

    // Restore path: tool_use_result is stripped by getSessionMessages,
    // convert content (Anthropic API format) → outputSchema format.
    const toolName = this.toolNames.get(toolCallId);
    if (toolName) {
      return contentToOutputSchema(toolName, content);
    }
    return content;
  }
}

export async function materializeSDKMessagesToUIMessage(
  messages: Iterable<SDKMessage> | AsyncIterable<SDKMessage>,
  options?: {
    transformer?: SDKMessageTransformer;
  },
): Promise<ClaudeCodeUIMessage | undefined> {
  const transformer = options?.transformer ?? new SDKMessageTransformer();

  const stream = createUIMessageStream<ClaudeCodeUIMessage>({
    async execute({ writer }) {
      for await (const message of messages) {
        for await (const chunk of transformer.transformWithAggregation(message)) {
          writer.write(chunk);
        }
      }
    },
  });

  let last: ClaudeCodeUIMessage | undefined;
  for await (const message of readUIMessageStream<ClaudeCodeUIMessage>({ stream })) {
    last = message;
  }

  return last;
}

/**
 * Convert SDK message to a subscribe-stream event.
 * Returns null for messages handled by the message stream
 * (assistant, user, system/init, system/compact_boundary).
 */
export function toUIEvent(msg: SDKMessage): ClaudeCodeUIEvent | null {
  switch (msg.type) {
    case "result":
    case "tool_progress":
    case "tool_use_summary":
    case "auth_status":
    case "prompt_suggestion":
    case "rate_limit_event": {
      return { kind: "event", event: { id: (msg as any).uuid ?? crypto.randomUUID(), ...msg } };
    }
    case "system": {
      const subtype = (msg as { subtype: string }).subtype;
      if (
        subtype === "init" ||
        subtype === "compact_boundary" ||
        subtype === "session_state_changed"
      )
        return null;
      return {
        kind: "event",
        event: { id: (msg as any).uuid ?? crypto.randomUUID(), ...msg },
      } as ClaudeCodeUIEvent;
    }
    default:
      return null;
  }
}
