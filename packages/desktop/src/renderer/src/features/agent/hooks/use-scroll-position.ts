import type { RefObject } from "react";

import debug from "debug";
import { useEffect } from "react";

import type { ConversationHandle } from "../../../components/ai-elements/conversation";

import { scrollPositions } from "../scroll-positions";

const log = debug("neovate:agent-scroll");

/**
 * Saves scroll position per session on scroll and unmount.
 */
export function useScrollPosition(
  sessionId: string,
  contextRef: RefObject<ConversationHandle | null>,
): void {
  // Save scroll position on scroll (debounced) and on unmount
  useEffect(() => {
    const handle = contextRef.current;
    const el = handle?.scrollerEl();
    if (!handle || !el) {
      log("save-effect: sid=%s skipped (scroller unavailable)", sessionId.slice(0, 8));
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout>;
    let userHasScrolled = false;
    const handleScroll = () => {
      userHasScrolled = true;
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 1;
        if (atBottom) {
          scrollPositions.delete(sessionId);
        } else {
          scrollPositions.set(sessionId, el.scrollTop);
        }
        log(
          "scroll: sid=%s atBottom=%s scrollTop=%d",
          sessionId.slice(0, 8),
          atBottom,
          el.scrollTop,
        );
      }, 200);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      clearTimeout(timeoutId);
      el.removeEventListener("scroll", handleScroll);
      // Skip save if element is detached or no user scroll occurred (Strict Mode)
      if (el.scrollHeight === 0 || !userHasScrolled) {
        log(
          "unmount: sid=%s skipped (detached=%s userScrolled=%s)",
          sessionId.slice(0, 8),
          el.scrollHeight === 0,
          userHasScrolled,
        );
        return;
      }
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 1;
      if (atBottom) {
        scrollPositions.delete(sessionId);
      } else {
        scrollPositions.set(sessionId, el.scrollTop);
      }
      log("unmount: sid=%s saved=%s scrollTop=%d", sessionId.slice(0, 8), !atBottom, el.scrollTop);
    };
  }, [sessionId]);
}
