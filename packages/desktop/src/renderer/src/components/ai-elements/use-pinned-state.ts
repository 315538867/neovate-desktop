import type { RefObject } from "react";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * User-intent state for "follow new content to bottom" — the single truth source
 * for whether the conversation should auto-follow streaming output.
 *
 * Design: the pin is flipped ONLY by deliberate user actions and by the user
 * actually settling at the geometric bottom (via `scrollend`). Streaming-driven
 * scrollHeight growth, programmatic scroll corrections, and Virtuoso's internal
 * SIZE_INCREASED measurement passes do NOT touch the pin. This is the property
 * that prevents:
 *   - the user being yanked back to bottom while reading scrollback
 *   - flicker / "auto-scroll to elsewhere" after the user releases the wheel
 *
 * Flip OFF (stop following):
 *   - wheel with deltaY < 0 (mouse/trackpad scroll up)
 *   - touchmove finger moving down (content scrolling up)
 *   - keyboard PageUp / Home / ArrowUp on the scroller
 *   - leaveBottom() called externally
 *
 * Flip ON (resume following):
 *   - keyboard End on the scroller
 *   - `scrollend` event fires AND the scroller is at geometric bottom
 *     (i.e. the user scrolled down to the bottom AND has stopped scrolling)
 *   - reachBottom() / pinToBottom() called externally
 *
 * Mutating the pin does NOT trigger re-renders — the value is held in a ref
 * so consumers like Virtuoso's `followOutput` callback can read the latest
 * value at evaluation time.
 *
 * NOTE on `scrollend`: a W3C standard event (Chromium 113+, Safari 18.2+)
 * that fires only after scrolling fully stops. Crucially, it does NOT fire
 * when scrollHeight grows while scrollTop is fixed (which is what happens
 * during streaming) — this is the property that lets us drop the previous
 * `scroll`-event-based heuristics that misfired during streaming.
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
};

const AT_BOTTOM_EPS = 1;

export function usePinnedState(scrollerRef: RefObject<HTMLElement | null>): PinnedState {
  const isPinnedRef = useRef(true);

  const pinToBottom = useCallback(() => {
    isPinnedRef.current = true;
  }, []);
  const leaveBottom = useCallback(() => {
    isPinnedRef.current = false;
  }, []);
  const reachBottom = useCallback(() => {
    isPinnedRef.current = true;
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
    // Re-engage follow ONLY after the user has fully stopped scrolling AND is
    // at the geometric bottom. `scrollend` does not fire on streaming-driven
    // scrollHeight growth, so this is safe during AI output.
    const onScrollEnd = () => {
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

  return { isPinnedRef, pinToBottom, leaveBottom, reachBottom };
}
