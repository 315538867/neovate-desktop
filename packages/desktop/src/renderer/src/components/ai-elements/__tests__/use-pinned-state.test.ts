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
function renderPinned() {
  const el = document.createElement("div");
  document.body.append(el);

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
});
