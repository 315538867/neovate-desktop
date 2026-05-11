import type { RefObject } from "react";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * User-intent state for "follow new content to bottom" — the single truth source
 * for whether the conversation should auto-follow streaming output.
 *
 * Design: the pin is flipped ON only by deliberate user actions (keyboard End,
 * programmatic pinToBottom) OR by the user actually settling at the geometric
 * bottom (regardless of input device — wheel, touch, keyboard, OR scrollbar
 * drag). Streaming-driven scrollHeight growth, programmatic scroll corrections,
 * Virtuoso's SIZE_* measurement passes, and browser scrollTop-clamp after a
 * programmatic height shrink (e.g. Reasoning auto-collapse) do NOT touch the
 * pin — the height-shrink mask suppresses scrollend during such transitions.
 *
 * This is the property that prevents:
 *   - the user being yanked back to bottom while reading scrollback
 *   - flicker / "auto-scroll to elsewhere" after the user releases the wheel
 *   - re-pinning to bottom after a Reasoning/summary/tool/chain-of-thought
 *     block collapses and the browser clamps scrollTop such that scrollend
 *     fires at the new bottom
 *
 * Flip OFF (stop following):
 *   - wheel with deltaY < 0 (mouse/trackpad scroll up)
 *   - touchmove finger moving down (content scrolling up)
 *   - keyboard PageUp / Home / ArrowUp on the scroller
 *   - leaveBottom() called externally
 *
 * Flip ON (resume following):
 *   - keyboard End on the scroller
 *   - `scrollend` event fires AND the scroller is at geometric bottom AND we
 *     are not inside a programmatic-height-shrink mask window
 *   - reachBottom() / pinToBottom() called externally
 *
 * Mutating the pin does NOT trigger re-renders — the value is held in a ref
 * so consumers like Virtuoso's `followOutput` callback can read the latest
 * value at evaluation time.
 *
 * NOTE on `scrollend`: a W3C standard event (Chromium 113+, Safari 18.2+)
 * that fires after scrolling fully stops. Crucially, it does NOT fire when
 * scrollHeight grows while scrollTop is fixed. HOWEVER, when scrollHeight
 * SHRINKS (e.g. a Reasoning/Tool/ChainOfThought block collapses), the
 * browser clamps scrollTop to `scrollHeight - clientHeight`, and this clamp
 * emits scroll + scrollend events. The `notifyHeightShrink` mask (600ms) is
 * the SOLE defense against that clamp re-pinning unintentionally — therefore
 * EVERY collapse-close path in the conversation MUST call notifyHeightShrink
 * before triggering the height change. Currently load-bearing callers:
 *   - Reasoning (reasoning.tsx)
 *   - AssistantMessage Summary (use-assistant-message-summary-collapse.ts)
 *   - Tool (tool.tsx)
 *   - ChainOfThought (chain-of-thought.tsx)
 */
export type PinnedState = {
  /** Stable ref consumers can read inside callbacks (e.g. followOutput). */
  isPinnedRef: RefObject<boolean>;
  /** Force pin ON (e.g. programmatic scrollToBottom, user pressed End). */
  pinToBottom: () => void;
  /** Force pin OFF (e.g. user-initiated scroll away). */
  leaveBottom: () => void;
  /** Notify hook the user reached the geometric bottom (re-engages follow). */
  reachBottom: () => void;
  /**
   * Notify hook that a programmatic height shrink is about to happen (e.g. a
   * Reasoning block is auto-collapsing). For the next ~600ms, `scrollend`
   * events will NOT re-pin, even if geometry reads "at bottom". This blocks
   * the browser's scrollTop-clamp side-effect from stealing follow intent.
   */
  notifyHeightShrink: () => void;
};

const AT_BOTTOM_EPS = 1;
/**
 * Mask window after a programmatic height shrink (e.g. Reasoning collapse).
 * During this window we ignore `scrollend` entirely for pin purposes, since
 * any scroll motion is the browser's scrollTop-clamp, not the user.
 *
 * 600ms covers the Collapsible CSS / motion transition (~200-300ms) plus
 * layout settle plus a generous safety margin. This mask is the SOLE defense
 * against scrollTop-clamp re-pinning, since the previous "downward intent
 * gate" was removed (it could not detect scrollbar-thumb drags, breaking
 * re-engagement of auto-follow when users dragged to bottom).
 */
const HEIGHT_SHRINK_MASK_MS = 600;

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function usePinnedState(scrollerRef: RefObject<HTMLElement | null>): PinnedState {
  const isPinnedRef = useRef(true);
  const heightShrinkUntilRef = useRef(0);

  const pinToBottom = useCallback(() => {
    isPinnedRef.current = true;
  }, []);
  const leaveBottom = useCallback(() => {
    isPinnedRef.current = false;
  }, []);
  const reachBottom = useCallback(() => {
    isPinnedRef.current = true;
  }, []);
  const notifyHeightShrink = useCallback(() => {
    heightShrinkUntilRef.current = now() + HEIGHT_SHRINK_MASK_MS;
  }, []);

  // Track readiness of the scroller element since some hosts (react-virtuoso)
  // assign it asynchronously via a ref callback. Re-bind listeners once it
  // becomes available.
  const [scrollerReady, setScrollerReady] = useState(false);
  useEffect(() => {
    if (scrollerReady) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (scrollerRef.current) {
        setScrollerReady(true);
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [scrollerReady, scrollerRef]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    let touchStartY = 0;

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        isPinnedRef.current = false;
      }
    };
    const onTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const dy = (e.touches[0]?.clientY ?? 0) - touchStartY;
      // Finger moves DOWN → content scrolls UP (away from bottom).
      if (dy > 0) {
        isPinnedRef.current = false;
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "PageUp" || e.key === "Home" || e.key === "ArrowUp") {
        isPinnedRef.current = false;
      } else if (e.key === "End") {
        isPinnedRef.current = true;
      }
    };
    // Re-engage follow when both hold:
    //   1. Not inside a programmatic-height-shrink mask window (the shrink
    //      itself emits scrollend via scrollTop clamp — ignore it).
    //   2. The scroller is actually at the geometric bottom.
    //
    // Note: previously this also required a "recent downward scroll intent"
    // (wheel/touch/keydown), but that gate broke scrollbar-thumb drags
    // (which produce no input events) and slow scrolls (settle > 250ms).
    // The mask window in (1) is a sufficient defense against the only known
    // false-positive (scrollTop-clamp from a programmatic height shrink),
    // PROVIDED every collapse-close path calls notifyHeightShrink first.
    const onScrollEnd = () => {
      if (now() < heightShrinkUntilRef.current) return;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_EPS) {
        isPinnedRef.current = true;
      }
    };

    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("scrollend", onScrollEnd as EventListener, { passive: true });

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("scrollend", onScrollEnd as EventListener);
    };
  }, [scrollerReady, scrollerRef]);

  return { isPinnedRef, pinToBottom, leaveBottom, reachBottom, notifyHeightShrink };
}
