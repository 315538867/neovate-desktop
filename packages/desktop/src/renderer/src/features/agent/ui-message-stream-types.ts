/**
 * Local type supplements for process-ui-message-stream.ts.
 *
 * These types/utilities are NOT exported by ai@6.0.145 — they are copied verbatim
 * from the AI SDK source (ai/packages/ai/src/ui/ui-messages.ts and
 * ai/packages/ai/src/ui-message-stream/ui-message-chunks.ts) so the 1:1 port can
 * operate without touching upstream-derived logic.
 *
 * Keep the type defs here in lockstep with upstream when re-syncing.
 */
import { type FlexibleSchema, type ToolCall } from "@ai-sdk/provider-utils";
import {
  type ProviderMetadata,
  type ReasoningUIPart,
  type TextUIPart,
  type UIDataTypes,
  type UIMessage,
  type UIMessageChunk,
  type UIMessagePart,
  type UITools,
  type FinishReason,
} from "ai";

// ── Inference helpers (ai/src/ui/ui-messages.ts) ────────────────────────────

export type ValueOf<
  ObjectType,
  ValueType extends keyof ObjectType = keyof ObjectType,
> = ObjectType[ValueType];

export type InferUIMessageMetadata<T extends UIMessage> =
  T extends UIMessage<infer METADATA> ? METADATA : unknown;

export type InferUIMessageData<T extends UIMessage> =
  T extends UIMessage<unknown, infer DATA_TYPES> ? DATA_TYPES : UIDataTypes;

export type InferUIMessageTools<T extends UIMessage> =
  T extends UIMessage<unknown, UIDataTypes, infer TOOLS> ? TOOLS : UITools;

export type InferUIMessageToolCall<UI_MESSAGE extends UIMessage> =
  | ValueOf<{
      [NAME in keyof InferUIMessageTools<UI_MESSAGE>]: ToolCall<
        NAME & string,
        InferUIMessageTools<UI_MESSAGE>[NAME] extends { input: infer INPUT } ? INPUT : never
      > & { dynamic?: false };
    }>
  | (ToolCall<string, unknown> & { dynamic: true });

// ── Data chunk types (ai/src/ui-message-stream/ui-message-chunks.ts) ────────

export type DataUIMessageChunk<DATA_TYPES extends UIDataTypes> = ValueOf<{
  [NAME in keyof DATA_TYPES & string]: {
    type: `data-${NAME}`;
    id?: string;
    data: DATA_TYPES[NAME];
    transient?: boolean;
  };
}>;

export type UIDataTypesToSchemas<T extends UIDataTypes> = {
  [K in keyof T]: FlexibleSchema<T[K]>;
};

// ── Custom content (in AI SDK head, not in ai@6.0.145) ──────────────────────

export type CustomContentUIPart = {
  type: "custom";
  kind: string;
  providerMetadata?: ProviderMetadata;
};

// Extended chunk type that includes chunk types present in AI SDK source head
// but not yet in ai@6.0.145's UIMessageChunk union.
export type ExtendedUIMessageChunk =
  | UIMessageChunk
  | {
      type: "custom";
      kind: string;
      providerMetadata?: ProviderMetadata;
    }
  | {
      type: "reasoning-file";
      url: string;
      mediaType: string;
      providerMetadata?: ProviderMetadata;
    };

export function isDataUIMessageChunk(
  chunk: ExtendedUIMessageChunk,
): chunk is DataUIMessageChunk<Record<string, unknown>> {
  return chunk.type.startsWith("data-");
}

// ── Streaming state ─────────────────────────────────────────────────────────

export type StreamingUIMessageState<UI_MESSAGE extends UIMessage> = {
  message: UI_MESSAGE;
  activeTextParts: Record<string, TextUIPart>;
  activeReasoningParts: Record<string, ReasoningUIPart>;
  partialToolCalls: Record<
    string,
    {
      text: string;
      index: number;
      toolName: string;
      dynamic?: boolean;
      title?: string;
    }
  >;
  finishReason?: FinishReason;
};

export function createStreamingUIMessageState<UI_MESSAGE extends UIMessage>({
  lastMessage,
  messageId,
}: {
  lastMessage: UI_MESSAGE | undefined;
  messageId: string;
}): StreamingUIMessageState<UI_MESSAGE> {
  return {
    message:
      lastMessage?.role === "assistant"
        ? lastMessage
        : ({
            id: messageId,
            metadata: undefined,
            role: "assistant",
            parts: [] as UIMessagePart<
              InferUIMessageData<UI_MESSAGE>,
              InferUIMessageTools<UI_MESSAGE>
            >[],
          } as UI_MESSAGE),
    activeTextParts: {},
    activeReasoningParts: {},
    partialToolCalls: {},
  };
}
