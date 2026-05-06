/**
 * Confirm-bus contract (Wave 4.3 commit 7.3).
 *
 * The bus sits between main's deeplink dispatcher and the renderer's
 * modal. The properties under test:
 *   - approve / reject responses resolve the right promise
 *   - timeout defaults to deny (silent dispatch is the failure we're
 *     trying to prevent — never approve if the renderer doesn't answer)
 *   - unknown / late responses are no-ops, not crashes
 *   - dispose() default-denies all pending requests
 *
 * NOTE on timers: fake timers are scoped to the timeout test only. The
 * `EventPublisher` async iterator relies on real microtask scheduling; if
 * fake timers are global, `for await ... bus.publisher.subscribe()` never
 * yields and the captured event stays null.
 */

import { describe, expect, it, vi } from "vitest";

import { DeeplinkConfirmBus } from "../confirm-bus";

async function captureFirstEvent(bus: DeeplinkConfirmBus) {
  let captured: { requestId: string } | null = null;
  void (async () => {
    for await (const event of bus.publisher.subscribe("confirm")) {
      captured = event;
      break;
    }
  })();
  // Wait until the iterator wires up its internal listener; one microtask
  // is enough in practice but we flush a few to be safe.
  for (let i = 0; i < 5; i++) await Promise.resolve();
  return () => captured;
}

describe("DeeplinkConfirmBus (Wave 4.3 commit 7.3)", () => {
  it("resolves true when the renderer approves", async () => {
    const bus = new DeeplinkConfirmBus(30_000);
    const getCaptured = await captureFirstEvent(bus);

    const promise = bus.request({
      url: "neovate://session/abc",
      scheme: "neovate",
      host: "session",
    });

    // Let the publisher deliver to the subscriber.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const captured = getCaptured();
    expect(captured).not.toBeNull();
    bus.respond(captured!.requestId, true);
    await expect(promise).resolves.toBe(true);
  });

  it("resolves false when the renderer rejects", async () => {
    const bus = new DeeplinkConfirmBus(30_000);
    const getCaptured = await captureFirstEvent(bus);

    const promise = bus.request({
      url: "neovate://session/abc",
      scheme: "neovate",
      host: "session",
    });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const captured = getCaptured();
    expect(captured).not.toBeNull();
    bus.respond(captured!.requestId, false);
    await expect(promise).resolves.toBe(false);
  });

  it("defaults to deny on timeout (no renderer response)", async () => {
    vi.useFakeTimers();
    try {
      const bus = new DeeplinkConfirmBus(30_000);
      const promise = bus.request({
        url: "neovate://session/abc",
        scheme: "neovate",
        host: "session",
      });
      vi.advanceTimersByTime(30_000);
      await expect(promise).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores unknown requestIds without throwing", () => {
    const bus = new DeeplinkConfirmBus(30_000);
    expect(() => bus.respond("does-not-exist", true)).not.toThrow();
  });

  it("ignores late responses (already resolved)", async () => {
    const bus = new DeeplinkConfirmBus(30_000);
    const getCaptured = await captureFirstEvent(bus);

    const promise = bus.request({
      url: "neovate://session/abc",
      scheme: "neovate",
      host: "session",
    });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const captured = getCaptured();
    expect(captured).not.toBeNull();
    bus.respond(captured!.requestId, true);
    await expect(promise).resolves.toBe(true);
    // Second response for the same id is a no-op.
    expect(() => bus.respond(captured!.requestId, false)).not.toThrow();
  });

  it("dispose() rejects all pending requests with deny", async () => {
    const bus = new DeeplinkConfirmBus(30_000);
    const a = bus.request({ url: "neovate://x", scheme: "neovate", host: "x" });
    const b = bus.request({ url: "neovate://y", scheme: "neovate", host: "y" });
    bus.dispose();
    await expect(a).resolves.toBe(false);
    await expect(b).resolves.toBe(false);
  });

  it("publishes a stable requestId on each event", async () => {
    const bus = new DeeplinkConfirmBus(30_000);
    const captured: string[] = [];
    void (async () => {
      let count = 0;
      for await (const event of bus.publisher.subscribe("confirm")) {
        captured.push(event.requestId);
        count++;
        if (count === 2) break;
      }
    })();

    // Allow the iterator to wire up before publishing.
    for (let i = 0; i < 5; i++) await Promise.resolve();

    void bus.request({ url: "neovate://a", scheme: "neovate", host: "a" });
    void bus.request({ url: "neovate://b", scheme: "neovate", host: "b" });

    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(captured.length).toBe(2);
    expect(captured[0]).not.toBe(captured[1]); // each request has its own id
  });
});
