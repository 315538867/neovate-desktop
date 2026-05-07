import { useMemo } from "react";
import { useStore } from "zustand";

import { claudeCodeChatManager } from "../chat-manager";

function getChatOrThrow(sessionId: string) {
  const chat = claudeCodeChatManager.getChat(sessionId);
  if (!chat) throw new Error(`No chat for session ${sessionId}`);
  return chat;
}

export function useClaudeCodeChat(sessionId: string) {
  const chat = getChatOrThrow(sessionId);

  // Subscribe to the two source-of-truth slots separately so memoized list
  // components can short-circuit on stableMessages reference equality.
  // The combined array is rebuilt only when either slot changes.
  const stableMessages = useStore(chat.store, (state) => state.stableMessages);
  const streamingMessage = useStore(chat.store, (state) => state.streamingMessage);
  const messages = useMemo(
    () => (streamingMessage ? [...stableMessages, streamingMessage] : stableMessages),
    [stableMessages, streamingMessage],
  );
  const status = useStore(chat.store, (state) => state.status);
  const error = useStore(chat.store, (state) => state.error);
  const eventError = useStore(chat.store, (state) => state.eventError);
  const pendingRequests = useStore(chat.store, (state) => state.pendingRequests);

  return {
    id: sessionId,
    messages,
    status,
    error,
    eventError,
    pendingRequests,
    sendMessage: chat.sendMessage.bind(chat),
    respondToRequest: chat.respondToRequest,
    stop: chat.interrupt,
    clearError: chat.clearError,
  };
}

/**
 * Fine-grained selectors for the stable / streaming split. Use these when a
 * subtree needs only one of the two slots — subscribing to a single slot
 * lets the component skip re-renders driven by the other slot's updates.
 *
 * Wave 2 Step 4: ConversationView uses these to keep the input / permission
 * UI from re-rendering on every streaming flush.
 */
export function useChatStableMessages(sessionId: string) {
  const chat = getChatOrThrow(sessionId);
  return useStore(chat.store, (state) => state.stableMessages);
}

export function useChatStreamingMessage(sessionId: string) {
  const chat = getChatOrThrow(sessionId);
  return useStore(chat.store, (state) => state.streamingMessage);
}
