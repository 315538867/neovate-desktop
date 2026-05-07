import type { RefObject } from "react";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * User-intent state for "follow new content to bottom" — the single truth source
 * for whether the conversation should auto-follow streaming output.
 *
 * Design: the pin is flipped ON only by deliberate user actions (keyboard End,
 * programmatic pinToBottom) OR by the user actually scrolling DOWN and settling
 * at the geometric bottom. Streaming-driven scrollHeight growth, programmatic
 * scroll corrections, Virtuoso's SIZE_* measurement passes, and browser
 * scrollTop-clamp after a programmatic height shrink (e.g. Reasoning auto-
 * collapse) do NOT touch the pin.
 *
 * This is the property that prevents:
 *   - the user being yanked back to bottom while reading scrollback
 *   - flicker / "auto-scroll to elsewhere" after the user releases the wheel
 *   - re-pinning to bottom after a Reasoning/summary block collapses and the
 *     browser clamps scrollTop such that scrollend fires at the new bottom
 *
 * Flip OFF (stop following):
 *   - wheel with deltaY < 0 (mouse/trackpad scroll up)
 *   - touchmove finger moving down (content scrolling up)
 *   - keyboard PageUp / Home / ArrowUp on the scroller
 *   - leaveBottom() called externally
 *
 * Flip ON (resume following):
 *   - keyboard End on the scroller
 *   - `scrollend` event fires AND the scroller is at geometric bottom AND the
 *     user expressed a recent (<= 250ms) downward scroll intent AND we are
 *     not inside a programmatic-height-shrink mask window
 *   - reachBottom() / pinToBottom() called externally
 *
 * Mutating the pin does NOT trigger re-renders — the value is held in a ref
 * so consumers like Virtuoso's `followOutput` callback can read the latest
 * value at evaluation time.
 *
 * NOTE on `scrollend`: a W3C standard event (Chromium 113+, Safari 18.2+)
 * that fires after scrolling fully stops. Crucially, it does NOT fire when
 * scrollHeight grows while scrollTop is fixed. HOWEVER, when scrollHeight
 * SHRINKS (e.g. a Reasoning block auto-collapses), the browser clamps
 * scrollTop to `scrollHeight - clientHeight`, and this clamp emits scroll +
 * scrollend events. Without the "recent downward intent" gate, that clamp
 * was silently re-pinning users who were reading scrollback.
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
   * Reasoning block is auto-collapsing). For the next ~350ms, `scrollend`
   * events will NOT re-pin, even if geometry reads "at bottom". This blocks
   * the browser's scrollTop-clamp side-effect from stealing follow intent.
   */
  notifyHeightShrink: () => void;
};

const AT_BOTTOM_EPS = 1;
/**
 * Window after a user's downward scroll input during which a `scrollend` at
 * bottom is accepted as "the user settled at bottom intentionally". 250ms
 * matches typical inertia-scroll settle timings on mouse wheel / trackpad /
 * touch without being so long that an unrelated browser-clamp scrollend
 * slips in.
 */
const DOWN_INTENT_WINDOW_MS = 250;
/**
 * Mask window after a programmatic height shrink (e.g. Reasoning collapse).
 * During this window we ignore `scrollend` entirely for pin purposes, since
 * any scroll motion is the browser's scrollTop-clamp, not the user.
 * 350ms covers the collapsible CSS transition + layout settle.
 */
const HEIGHT_SHRINK_MASK_MS = 350;

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function usePinnedState(scrollerRef: RefObject<HTMLElement | null>): PinnedState {
  const isPinnedRef = useRef(true);
  const lastUserDownIntentAtRef = useRef(0);
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

    const markDownIntent = () => {
      lastUserDownIntentAtRef.current = now();
    };

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        isPinnedRef.current = false;
      } else if (e.deltaY > 0) {
        markDownIntent();
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
      } else if (dy < 0) {
        // Finger moves UP → content scrolls DOWN (toward bottom).
        markDownIntent();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "PageUp" || e.key === "Home" || e.key === "ArrowUp") {
        isPinnedRef.current = false;
      } else if (e.key === "End") {
        isPinnedRef.current = true;
      } else if (e.key === "PageDown" || e.key === "ArrowDown") {
        markDownIntent();
      }
    };
    // Re-engage follow ONLY when all three hold:
    //   1. Not inside a programmatic-height-shrink mask window (the shrink
    //      itself emits scrollend via scrollTop clamp — ignore it).
    //   2. The user expressed a recent downward-scroll intent (so this
    //      scrollend is the settle of a user-initiated downward scroll, not
    //      an unrelated clamp or an inertia settle from another source).
    //   3. The scroller is actually at the geometric bottom.
    const onScrollEnd = () => {
      const t = now();
      if (t < heightShrinkUntilRef.current) return;
      if (t - lastUserDownIntentAtRef.current > DOWN_INTENT_WINDOW_MS) return;
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
