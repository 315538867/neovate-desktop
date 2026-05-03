/**
 * @vitest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import { describe, it, expect, beforeEach } from "vitest";

import { usePinnedState } from "../use-pinned-state";

/**
 * Render usePinnedState with a real DOM element so the input-event listeners
 * have a target to attach to. The element is created fresh per test and held
 * in a useRef on the wrapper component, mirroring how Conversation passes the
 * scrollerRef into the hook.
 */
function renderPinned(initialGeometry?: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}) {
  const el = document.createElement("div");
  document.body.append(el);
  if (initialGeometry) mockGeometry(el, initialGeometry);

  const { result, unmount } = renderHook(() => {
    const ref = useRef<HTMLElement | null>(el);
    return usePinnedState(ref);
  });

  return {
    result,
    el,
    unmount: () => {
      unmount();
      el.remove();
    },
  };
}

/**
 * Mocks scroll geometry on the DOM element. jsdom does not lay out, so
 * scrollTop / scrollHeight / clientHeight need to be stubbed per-test.
 * Hoisted above renderPinned so the helper can apply it before mount.
 */
function mockGeometry(
  el: HTMLElement,
  geom: { scrollTop: number; scrollHeight: number; clientHeight: number },
) {
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => geom.scrollTop,
  });
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    get: () => geom.scrollHeight,
  });
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    get: () => geom.clientHeight,
  });
}

/** Wait for the rAF-driven scrollerReady tick to resolve and listeners to bind. */
async function waitForListenersBound() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    // One extra tick to let React commit the scrollerReady=true effect.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

describe("usePinnedState", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("starts pinned (isPinnedRef.current === true)", () => {
    const { result, unmount } = renderPinned();
    expect(result.current.isPinnedRef.current).toBe(true);
    unmount();
  });

  it("pinToBottom forces pin ON", () => {
    const { result, unmount } = renderPinned();
    act(() => result.current.leaveBottom());
    expect(result.current.isPinnedRef.current).toBe(false);
    act(() => result.current.pinToBottom());
    expect(result.current.isPinnedRef.current).toBe(true);
    unmount();
  });

  it("leaveBottom forces pin OFF", () => {
    const { result, unmount } = renderPinned();
    act(() => result.current.leaveBottom());
    expect(result.current.isPinnedRef.current).toBe(false);
    unmount();
  });

  it("reachBottom forces pin ON (re-engage follow)", () => {
    const { result, unmount } = renderPinned();
    act(() => result.current.leaveBottom());
    expect(result.current.isPinnedRef.current).toBe(false);
    act(() => result.current.reachBottom());
    expect(result.current.isPinnedRef.current).toBe(true);
    unmount();
  });

  it("wheel deltaY < 0 (scroll up) flips pin OFF", async () => {
    const { result, el, unmount } = renderPinned();
    await waitForListenersBound();

    expect(result.current.isPinnedRef.current).toBe(true);
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: -10 }));
    expect(result.current.isPinnedRef.current).toBe(false);
    unmount();
  });

  it("wheel deltaY > 0 (scroll down) does NOT flip pin", async () => {
    const { result, el, unmount } = renderPinned();
    await waitForListenersBound();

    el.dispatchEvent(new WheelEvent("wheel", { deltaY: 10 }));
    expect(result.current.isPinnedRef.current).toBe(true);
    unmount();
  });

  it("touchmove with finger moving DOWN flips pin OFF", async () => {
    const { result, el, unmount } = renderPinned();
    await waitForListenersBound();

    // Simulate touchstart at clientY=100, then touchmove at clientY=160 (finger down → content up).
    el.dispatchEvent(
      new TouchEvent("touchstart", {
        touches: [{ clientY: 100 } as Touch],
      }),
    );
    el.dispatchEvent(
      new TouchEvent("touchmove", {
        touches: [{ clientY: 160 } as Touch],
      }),
    );
    expect(result.current.isPinnedRef.current).toBe(false);
    unmount();
  });

  it("touchmove with finger moving UP does NOT flip pin", async () => {
    const { result, el, unmount } = renderPinned();
    await waitForListenersBound();

    el.dispatchEvent(
      new TouchEvent("touchstart", {
        touches: [{ clientY: 100 } as Touch],
      }),
    );
    el.dispatchEvent(
      new TouchEvent("touchmove", {
        touches: [{ clientY: 50 } as Touch],
      }),
    );
    expect(result.current.isPinnedRef.current).toBe(true);
    unmount();
  });

  it("keyboard PageUp / Home / ArrowUp flip pin OFF", async () => {
    const { result, el, unmount } = renderPinned();
    await waitForListenersBound();

    for (const key of ["PageUp", "Home", "ArrowUp"] as const) {
      act(() => result.current.pinToBottom());
      el.dispatchEvent(new KeyboardEvent("keydown", { key }));
      expect(result.current.isPinnedRef.current).toBe(false);
    }
    unmount();
  });

  it("keyboard End flips pin ON", async () => {
    const { result, el, unmount } = renderPinned();
    await waitForListenersBound();

    act(() => result.current.leaveBottom());
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));
    expect(result.current.isPinnedRef.current).toBe(true);
    unmount();
  });

  it("listeners are removed on unmount", async () => {
    const { result, el, unmount } = renderPinned();
    await waitForListenersBound();

    unmount();

    // After unmount, dispatching should not affect the (now stale) ref.
    // We snapshot the value first; since unmount removed listeners, dispatch is a no-op.
    const before = result.current.isPinnedRef.current;
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: -10 }));
    expect(result.current.isPinnedRef.current).toBe(before);
  });

  it("scrollend at geometric bottom flips pin ON (user settled at bottom)", async () => {
    const { result, el, unmount } = renderPinned({
      scrollTop: 1500,
      scrollHeight: 2000,
      clientHeight: 500,
    });
    await waitForListenersBound();

    act(() => result.current.leaveBottom());
    expect(result.current.isPinnedRef.current).toBe(false);
    // User has stopped scrolling AND is at the geometric bottom.
    el.dispatchEvent(new Event("scrollend"));
    expect(result.current.isPinnedRef.current).toBe(true);
    unmount();
  });

  it("scrollend NOT at geometric bottom keeps pin OFF (user settled mid-list)", async () => {
    const { result, el, unmount } = renderPinned({
      scrollTop: 800,
      scrollHeight: 2000,
      clientHeight: 500,
    });
    await waitForListenersBound();

    act(() => result.current.leaveBottom());
    expect(result.current.isPinnedRef.current).toBe(false);
    el.dispatchEvent(new Event("scrollend"));
    expect(result.current.isPinnedRef.current).toBe(false);
    unmount();
  });

  it("streaming scrollHeight growth (scroll events without scrollend) does NOT flip pin", async () => {
    // Regression test for the bug history: previously a `scroll` listener
    // misfired during streaming because scrollHeight kept growing while the
    // user was actively reading earlier history. The redesign removes that
    // listener — only `scrollend` re-engages follow, and `scrollend` does
    // not fire on programmatic / layout-driven scrollHeight growth.
    const { result, el, unmount } = renderPinned({
      scrollTop: 500,
      scrollHeight: 2000,
      clientHeight: 500,
    });
    await waitForListenersBound();

    act(() => result.current.leaveBottom());
    expect(result.current.isPinnedRef.current).toBe(false);
    // Streaming pushes scrollHeight up; user intent must persist.
    mockGeometry(el, { scrollTop: 500, scrollHeight: 2400, clientHeight: 500 });
    el.dispatchEvent(new Event("scroll"));
    el.dispatchEvent(new Event("scroll"));
    el.dispatchEvent(new Event("scroll"));
    expect(result.current.isPinnedRef.current).toBe(false);
    unmount();
  });
});
