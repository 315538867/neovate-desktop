import { isDataUIPart, isReasoningUIPart, isToolUIPart } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ClaudeCodeUIMessage } from "../../../../../shared/claude-code/types";

import {
  PIN_DEFER_DELAY_MS,
  PIN_DEFER_POLL_INTERVAL_MS,
  PIN_DEFER_POLL_TIMEOUT_MS,
  useDeferredUntilPinned,
} from "../../../components/ai-elements/use-deferred-until-pinned";

export type AssistantMessageSummaryCollapseOptions = {
  /**
   * Returns true when the conversation is currently pinned to bottom (i.e.
   * the user is following streaming output, not reading scrollback). When
   * provided and false, the auto-collapse step is deferred until the user
   * returns to the bottom — preventing the collapse from shrinking content
   * the user is actively reading.
   */
  getIsPinned?: () => boolean;
  /**
   * Called immediately before a programmatic collapse so the conversation's
   * scroll pinned-state can ignore the resulting browser scrollTop-clamp +
   * scrollend events. Without this, the clamp can silently re-pin the user.
   */
  notifyHeightShrink?: () => void;
};

export type CollapseMode = "normal" | "prepare" | "collapsed";
type CollapseKind = "live" | "restored" | null;
type DeliveryMode = "stream" | "restored" | undefined;

function isSummaryMessagePart(part: ClaudeCodeUIMessage["parts"][number]) {
  if (isToolUIPart(part) || isReasoningUIPart(part) || isDataUIPart(part)) {
    return false;
  }

  return part.type === "text" || part.type === "file";
}

function getSuccessResultText(part: ClaudeCodeUIMessage["parts"][number] | undefined) {
  if (part == null || !isDataUIPart(part) || part.type !== "data-result/success") {
    return null;
  }

  const data = part.data;
  if (data == null || typeof data !== "object" || !("result" in data)) {
    return null;
  }

  return typeof data.result === "string" ? data.result : null;
}

function getCollapseKind(args: {
  deliveryMode: DeliveryMode;
  hasInit: boolean;
  hasSuccess: boolean;
  hasSummaryContent: boolean;
  liveTrailingPartIndex: number;
  restoredTrailingPartIndex: number;
}): CollapseKind {
  const {
    deliveryMode,
    hasInit,
    hasSuccess,
    hasSummaryContent,
    liveTrailingPartIndex,
    restoredTrailingPartIndex,
  } = args;

  if (!hasSummaryContent) {
    return null;
  }

  if (deliveryMode === "restored" && restoredTrailingPartIndex !== -1) {
    return "restored";
  }

  if (hasInit && hasSuccess && liveTrailingPartIndex !== -1) {
    return "live";
  }

  return null;
}

function getTrailingPartIndex(args: {
  collapseKind: CollapseKind;
  liveTrailingPartIndex: number;
  restoredTrailingPartIndex: number;
}) {
  const { collapseKind, liveTrailingPartIndex, restoredTrailingPartIndex } = args;

  if (collapseKind === "live") {
    return liveTrailingPartIndex;
  }

  if (collapseKind === "restored") {
    return restoredTrailingPartIndex;
  }

  return -1;
}

export function useAssistantMessageSummaryCollapse(
  message: ClaudeCodeUIMessage,
  options?: AssistantMessageSummaryCollapseOptions,
) {
  const { getIsPinned, notifyHeightShrink } = options ?? {};
  // Keep latest options in refs so the effect deps stay stable; option
  // identity churn must NOT restart the auto-collapse timer.
  const getIsPinnedRef = useRef(getIsPinned);
  const notifyHeightShrinkRef = useRef(notifyHeightShrink);
  useEffect(() => {
    getIsPinnedRef.current = getIsPinned;
    notifyHeightShrinkRef.current = notifyHeightShrink;
  }, [getIsPinned, notifyHeightShrink]);
  const {
    collapsibleMessage,
    trailingMessage,
    collapseKind,
    messageCount,
    reasoningCount,
    toolCallCount,
  } = useMemo(() => {
    const firstPart = message.parts[0];
    const lastPart = message.parts.at(-1);
    const deliveryMode = message.metadata?.deliveryMode;
    const hasInit =
      firstPart != null && isDataUIPart(firstPart) && firstPart.type === "data-system/init";
    const hasSuccess =
      lastPart != null && isDataUIPart(lastPart) && lastPart.type === "data-result/success";
    const successResultText = getSuccessResultText(lastPart);

    let lastNonDataPartIndex = -1;
    let lastNonDataTextIndex = -1;
    let lastSummaryPartIndex = -1;
    let toolCallCount = 0;
    let messageCount = 0;
    let reasoningCount = 0;

    for (const part of message.parts) {
      if (isToolUIPart(part)) {
        if (part.type !== "dynamic-tool") {
          toolCallCount += 1;
        }
        continue;
      }

      if (isReasoningUIPart(part)) {
        reasoningCount += 1;
      }

      if (isSummaryMessagePart(part)) {
        messageCount += 1;
      }
    }

    for (let index = message.parts.length - 1; index >= 0; index -= 1) {
      const part = message.parts[index];
      if (isDataUIPart(part)) {
        continue;
      }

      lastNonDataPartIndex = index;
      if (part.type === "text") {
        lastNonDataTextIndex = index;
      }
      if (isSummaryMessagePart(part)) {
        lastSummaryPartIndex = index;
      }

      break;
    }

    const lastNonDataTextPart =
      lastNonDataTextIndex !== -1 ? message.parts[lastNonDataTextIndex] : null;
    const liveTrailingPartIndex =
      lastNonDataTextIndex !== -1 &&
      lastNonDataTextIndex === lastNonDataPartIndex &&
      lastNonDataTextPart?.type === "text" &&
      lastNonDataTextPart.text === successResultText
        ? lastNonDataTextIndex
        : -1;
    const hasRestoredProcessContent = toolCallCount > 0 || reasoningCount > 0;
    const restoredTrailingPartIndex =
      lastSummaryPartIndex !== -1 &&
      lastSummaryPartIndex === lastNonDataPartIndex &&
      hasRestoredProcessContent
        ? lastSummaryPartIndex
        : -1;
    const hasSummaryContent = toolCallCount > 0 || reasoningCount > 0;
    const collapseKind = getCollapseKind({
      deliveryMode,
      hasInit,
      hasSuccess,
      hasSummaryContent,
      liveTrailingPartIndex,
      restoredTrailingPartIndex,
    });
    const trailingPartIndex = getTrailingPartIndex({
      collapseKind,
      liveTrailingPartIndex,
      restoredTrailingPartIndex,
    });
    const collapsibleParts =
      trailingPartIndex === -1 ? message.parts : message.parts.slice(0, trailingPartIndex);
    const trailingParts = trailingPartIndex === -1 ? [] : message.parts.slice(trailingPartIndex);

    if (trailingPartIndex !== -1) {
      messageCount -= 1;
    }

    return {
      collapseKind,
      collapsibleMessage: { ...message, parts: collapsibleParts },
      messageCount,
      reasoningCount,
      trailingMessage: trailingParts.length > 0 ? { ...message, parts: trailingParts } : null,
      toolCallCount,
    };
  }, [message]);

  const [collapseMode, setCollapseMode] = useState<CollapseMode>(
    collapseKind === "restored" ? "collapsed" : "normal",
  );
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (collapseKind == null) {
      setCollapseMode("normal");
      setIsOpen(false);
      return undefined;
    }

    if (collapseKind === "restored") {
      setCollapseMode("collapsed");
      setIsOpen(false);
      return undefined;
    }

    if (collapseMode === "normal") {
      setCollapseMode("prepare");
      setIsOpen(true);
    }
  }, [collapseKind, collapseMode]);

  useDeferredUntilPinned({
    enabled: collapseKind === "live" && collapseMode === "prepare",
    getIsPinned: useCallback(() => getIsPinnedRef.current?.() ?? true, []),
    onCommit: useCallback(() => {
      notifyHeightShrinkRef.current?.();
      setCollapseMode("collapsed");
      setIsOpen(false);
    }, []),
    onTimeout: useCallback(() => {
      // Timed out — leave content expanded; do not yank the user.
      // Mark collapsed so the trigger isn't stuck in `prepare`.
      setCollapseMode("collapsed");
    }, []),
    delayMs: PIN_DEFER_DELAY_MS,
    pollIntervalMs: PIN_DEFER_POLL_INTERVAL_MS,
    timeoutMs: PIN_DEFER_POLL_TIMEOUT_MS,
  });

  return {
    collapseMode,
    collapsibleMessage,
    isCollapsible: collapseMode !== "normal" && trailingMessage != null,
    isOpen,
    messageCount,
    reasoningCount,
    setIsOpen,
    trailingMessage,
    toolCallCount,
  };
}
