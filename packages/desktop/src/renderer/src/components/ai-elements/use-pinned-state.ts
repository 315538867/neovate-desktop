import type { RefObject } from "react";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * User-intent state for "follow new content to bottom" — decoupled from any
 * geometric atBottom signal. The pin is the truth source for whether the
 * conversation should auto-follow streaming output.
 *
 * Flip OFF (stop following):
 *   - wheel with deltaY < 0 (mouse/trackpad scroll up)
 *   - touchmove finger moving down (content scrolling up)
 *   - keyboard PageUp / Home / ArrowUp on the scroller
 *   - scroll event with scrollTop decreasing (scrollbar drag, momentum tail)
 *   - leaveBottom() called externally
 *
 * Flip ON (resume following):
 *   - keyboard End on the scroller
 *   - scroll event reaching the geometric bottom
 *   - reachBottom() called externally (e.g. user reached geometric bottom by
 *     scrolling, or programmatic scrollToBottom was invoked)
 *   - pinToBottom() called externally
 *
 * Mutating the pin does NOT trigger re-renders — the value is held in a ref
 * so consumers like Virtuoso's `followOutput` callback can read the latest
 * value at evaluation time without paying the cost of React reconciliation
 * on every wheel tick.
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
    let lastScrollTop = el.scrollTop;

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
    // Scroll fallback: covers scrollbar drag (no wheel/touch event), trackpad
    // momentum tail, and "user naturally reached bottom → re-engage follow".
    // Compares against last seen scrollTop so streaming-induced scrollHeight
    // growth (which keeps scrollTop fixed) does not falsely flip pin.
    const onScroll = () => {
      const top = el.scrollTop;
      if (top < lastScrollTop - 1) {
        // User moved up.
        isPinnedRef.current = false;
      } else if (el.scrollHeight - top - el.clientHeight < 1) {
        // User reached the geometric bottom — re-engage follow intent.
        isPinnedRef.current = true;
      }
      lastScrollTop = top;
    };

    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("scroll", onScroll);
    };
  }, [scrollerReady, scrollerRef]);

  return { isPinnedRef, pinToBottom, leaveBottom, reachBottom };
}
