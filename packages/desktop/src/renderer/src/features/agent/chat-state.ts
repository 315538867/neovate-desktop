import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { ChatState, ChatStatus } from "ai";

import { createStore, type StoreApi } from "zustand/vanilla";

import type {
  ClaudeCodeUIEventRequest,
  ClaudeCodeUIMessage,
} from "../../../../shared/claude-code/types";
import type { PermissionMode } from "../../../../shared/features/agent/types";

export type ClaudeCodeChatCapabilities = Awaited<ReturnType<Query["initializationResult"]>>;

export interface PendingContextClear {
  plan: string;
  mode: PermissionMode;
  cwd?: string;
}

export interface ClaudeCodeChatStoreState {
  /**
   * Completed messages whose content will not change. Reference is stable
   * across streaming frames so memoized list components can skip reconciles.
   */
  stableMessages: ClaudeCodeUIMessage[];
  /**
   * The single in-flight assistant message during streaming. `null` when
   * idle. Promoted into `stableMessages` on `commitStreamingMessage()`.
   */
  streamingMessage: ClaudeCodeUIMessage | null;
  status: ChatStatus;
  error: Error | undefined;
  eventError: Error | undefined;
  pendingRequests: Array<{
    requestId: string;
    request: ClaudeCodeUIEventRequest;
  }>;
  capabilities: ClaudeCodeChatCapabilities | null;
  pendingContextClear?: PendingContextClear;

  // Prompt suggestion (follow-up)
  promptSuggestion: string | null;

  // Query status timing
  turnStartedAt: number | null;
  thinkingStartedAt: number | null;
  thinkingDuration: number | null;
  lastChunkAt: number | null;
}

/**
 * Cache for derived `messages` array. Recomputed only when stableMessages or
 * streamingMessage reference changes. This keeps `state.messages.at(-1)` and
 * `state.messages.findIndex(...)` callers cheap.
 */
type DerivedCache = {
  stable: ClaudeCodeUIMessage[];
  streaming: ClaudeCodeUIMessage | null;
  combined: ClaudeCodeUIMessage[];
};

/**
 * Subset of store fields written by per-message timing bookkeeping. Tightened
 * from `Partial<ClaudeCodeChatStoreState>` so a typo can't silently mutate
 * an unrelated field (e.g. `pendingRequests`).
 */
type TimingUpdate = Partial<
  Pick<ClaudeCodeChatStoreState, "thinkingStartedAt" | "thinkingDuration" | "lastChunkAt">
>;

export class ClaudeCodeChatState implements ChatState<ClaudeCodeUIMessage> {
  readonly store: StoreApi<ClaudeCodeChatStoreState>;
  #cache: DerivedCache | null = null;

  constructor(initialMessages: ClaudeCodeUIMessage[] = []) {
    this.store = createStore<ClaudeCodeChatStoreState>()(() => ({
      stableMessages: initialMessages,
      streamingMessage: null,
      status: "ready",
      error: undefined,
      eventError: undefined,
      pendingRequests: [],
      capabilities: null,
      promptSuggestion: null,
      turnStartedAt: null,
      thinkingStartedAt: null,
      thinkingDuration: null,
      lastChunkAt: null,
    }));
  }

  get messages(): ClaudeCodeUIMessage[] {
    const { stableMessages, streamingMessage } = this.store.getState();
    if (
      this.#cache &&
      this.#cache.stable === stableMessages &&
      this.#cache.streaming === streamingMessage
    ) {
      return this.#cache.combined;
    }
    const combined = streamingMessage ? [...stableMessages, streamingMessage] : stableMessages;
    this.#cache = { stable: stableMessages, streaming: streamingMessage, combined };
    return combined;
  }

  set messages(messages: ClaudeCodeUIMessage[]) {
    // External overwrite (rewind, fork, load): treat all as stable, drop
    // any in-flight streaming message.
    this.store.setState({ stableMessages: messages, streamingMessage: null });
  }

  get status() {
    return this.store.getState().status;
  }

  set status(status: ChatStatus) {
    const prev = this.store.getState().status;
    if ((status === "submitted" || status === "streaming") && prev === "ready") {
      this.store.setState({
        status,
        turnStartedAt: Date.now(),
        thinkingStartedAt: null,
        thinkingDuration: null,
        lastChunkAt: Date.now(),
      });
    } else {
      this.store.setState({ status });
    }
  }

  get error() {
    return this.store.getState().error;
  }

  set error(error: Error | undefined) {
    this.store.setState({ error });
  }

  /**
   * Append a finished message (user message, system event message). Goes
   * straight into `stableMessages` — never into the streaming slot.
   */
  pushMessage = (message: ClaudeCodeUIMessage) => {
    const now = Date.now();
    const state = this.store.getState();
    const timingUpdate: TimingUpdate = { lastChunkAt: now };

    // If thinking was active when a new message starts, accumulate duration
    if (state.thinkingStartedAt) {
      timingUpdate.thinkingDuration =
        (state.thinkingDuration ?? 0) + (now - state.thinkingStartedAt);
      timingUpdate.thinkingStartedAt = null;
    }

    this.store.setState((s) => ({
      ...timingUpdate,
      stableMessages: s.stableMessages.concat(this.snapshot(message)),
    }));
  };

  popMessage = () => {
    this.store.setState((state) => {
      // Prefer dropping the in-flight streaming message; fall back to the
      // last stable entry. Mirrors the previous combined-array semantics.
      if (state.streamingMessage) return { streamingMessage: null };
      return { stableMessages: state.stableMessages.slice(0, -1) };
    });
  };

  /**
   * Compute the timing-bookkeeping diff for a streaming-slot write. The last
   * part's type drives reasoning state — see `replaceMessage` /
   * `setStreamingMessage` callers.
   */
  #computeStreamingTiming = (message: ClaudeCodeUIMessage): TimingUpdate => {
    const now = Date.now();
    const state = this.store.getState();
    const lastPart = message.parts[message.parts.length - 1];
    const isReasoning = lastPart?.type === "reasoning";

    const update: TimingUpdate = {};

    if (isReasoning && !state.thinkingStartedAt) {
      update.thinkingStartedAt = now;
    } else if (!isReasoning && state.thinkingStartedAt) {
      update.thinkingDuration = (state.thinkingDuration ?? 0) + (now - state.thinkingStartedAt);
      update.thinkingStartedAt = null;
    }

    if (!isReasoning) {
      update.lastChunkAt = now;
    }

    return update;
  };

  /**
   * AI SDK contract: index is into the combined `messages` array. We map it
   * back to either the streaming slot or stableMessages, preserving the
   * original "replace by index" semantics for callers.
   */
  replaceMessage = (index: number, message: ClaudeCodeUIMessage) => {
    const timingUpdate = this.#computeStreamingTiming(message);
    const state = this.store.getState();

    const stableLen = state.stableMessages.length;
    if (state.streamingMessage && index === stableLen) {
      // Replacing the streaming slot — single-field write, stableMessages
      // reference is preserved → memoized stable list skips render.
      this.store.setState({ ...timingUpdate, streamingMessage: this.snapshot(message) });
      return;
    }

    // Replacing a stable entry (rewind path: chat.ts:300 replaces the user
    // message after slicing). stableMessages reference must change.
    this.store.setState((s) => ({
      ...timingUpdate,
      stableMessages: [
        ...s.stableMessages.slice(0, index),
        this.snapshot(message),
        ...s.stableMessages.slice(index + 1),
      ],
    }));
  };

  /**
   * Promote the in-flight streaming message to `stableMessages`. Called by
   * chat.ts on `chunk.type === "finish"`. Idempotent.
   */
  commitStreamingMessage = () => {
    this.store.setState((s) => {
      if (!s.streamingMessage) return {};
      return {
        stableMessages: s.stableMessages.concat(s.streamingMessage),
        streamingMessage: null,
      };
    });
  };

  /**
   * Write the streaming-slot message. Used when the streaming turn produces
   * its first/subsequent flush from chat.ts. Splits the previous
   * `pushMessage`+`replaceMessage` codepath so callers don't need to track
   * "is this the first frame" themselves.
   */
  setStreamingMessage = (message: ClaudeCodeUIMessage) => {
    const timingUpdate = this.#computeStreamingTiming(message);
    this.store.setState({ ...timingUpdate, streamingMessage: this.snapshot(message) });
  };

  snapshot = <T>(value: T): T => structuredClone(value);
}
