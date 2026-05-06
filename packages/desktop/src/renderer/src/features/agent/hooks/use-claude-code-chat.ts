import { useMemo } from "react";
import { useStore } from "zustand";

import { claudeCodeChatManager } from "../chat-manager";

export function useClaudeCodeChat(sessionId: string) {
  const chat = claudeCodeChatManager.getChat(sessionId);
  if (!chat) throw new Error(`No chat for session ${sessionId}`);

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
