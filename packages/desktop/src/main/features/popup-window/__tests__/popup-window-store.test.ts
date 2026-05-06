import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PopupWindowStore is a thin wrapper around electron-store that persists the
 * popup window's last size. We mock electron-store with an in-memory map so
 * we can assert on:
 *  - default size (480 × 320) applies before any saveSize() call
 *  - saveSize() / getSize() round-trip a custom size
 *  - independent fields (width / height) are stored separately
 *  - constructing two stores reads the same persisted data (singleton-ish
 *    semantics — electron-store keys by file name)
 */

// In-memory data shared across all Store instances created with the same
// `name` so we can assert cross-instance persistence.
const STORES: Record<string, Record<string, unknown>> = {};

vi.mock("electron-store", () => {
  const MockStore = vi.fn(function (
    this: any,
    opts?: { name?: string; defaults?: Record<string, unknown> },
  ) {
    const key = opts?.name ?? "default";
    if (!(key in STORES)) {
      STORES[key] = { ...opts?.defaults };
    }
    const data = STORES[key]!;
    this.get = (k: string) => data[k];
    this.set = (k: string, v: unknown) => {
      data[k] = v;
    };
  });
  return { default: MockStore };
});

describe("PopupWindowStore", () => {
  beforeEach(() => {
    // Reset between tests so independent suites don't leak state
    for (const k of Object.keys(STORES)) delete STORES[k];
  });

  it("returns the default 480 × 320 size when nothing has been saved", async () => {
    const { PopupWindowStore } = await import("../popup-window-store");
    const store = new PopupWindowStore();
    expect(store.getSize()).toEqual({ width: 480, height: 320 });
  });

  it("round-trips a custom size through saveSize / getSize", async () => {
    const { PopupWindowStore } = await import("../popup-window-store");
    const store = new PopupWindowStore();
    store.saveSize(900, 600);
    expect(store.getSize()).toEqual({ width: 900, height: 600 });
  });

  it("persists width and height independently (partial save reads back current value)", async () => {
    const { PopupWindowStore } = await import("../popup-window-store");
    const store = new PopupWindowStore();
    store.saveSize(900, 600);
    // Subsequent overwrite of just the height (via re-saving with new height)
    store.saveSize(900, 700);
    expect(store.getSize()).toEqual({ width: 900, height: 700 });
  });

  it("a fresh PopupWindowStore instance reads the previously persisted size", async () => {
    const { PopupWindowStore } = await import("../popup-window-store");
    const a = new PopupWindowStore();
    a.saveSize(1024, 768);
    const b = new PopupWindowStore();
    expect(b.getSize()).toEqual({ width: 1024, height: 768 });
  });
});
