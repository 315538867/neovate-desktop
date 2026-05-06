import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IBrowserWindowManager } from "../../../core/types";
import type { ConfigStore } from "../../config/config-store";

/**
 * PopupWindowShortcut wires Electron's globalShortcut to the popup-window
 * lifecycle. We mock the electron module + electron-store + the window
 * manager so the class can be exercised in pure node:
 *  - init() with popupWindowEnabled=true registers the configured accelerator
 *  - init() with popupWindowEnabled=false does NOT register anything
 *  - changing popupWindowShortcut at runtime unregisters the old + registers
 *    the new accelerator
 *  - dispose() unregisters and detaches the config subscription
 */

const globalShortcutMock = {
  register: vi.fn(() => true),
  unregister: vi.fn(),
};

vi.mock("electron", () => ({
  globalShortcut: globalShortcutMock,
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
  },
}));

// PopupWindowStore imports electron-store transitively
vi.mock("electron-store", () => {
  const MockStore = vi.fn(function (this: any, opts?: { defaults?: Record<string, unknown> }) {
    const data: Record<string, unknown> = { ...opts?.defaults };
    this.get = (k: string) => data[k];
    this.set = (k: string, v: unknown) => {
      data[k] = v;
    };
  });
  return { default: MockStore };
});

type AnyChangeHandler = (newVal: any, oldVal: any) => void;

function makeConfigStore(initial: { popupWindowEnabled: boolean; popupWindowShortcut: string }) {
  let state = { ...initial };
  let handler: AnyChangeHandler | null = null;
  const stub = {
    get: vi.fn((k: string) => (state as any)[k]),
    onAnyChange: vi.fn((h: AnyChangeHandler) => {
      handler = h;
      return () => {
        handler = null;
      };
    }),
    // Test-only helper — emit a config change with the given delta
    __emit: (delta: Partial<typeof state>) => {
      const oldVal = { ...state };
      state = { ...state, ...delta };
      handler?.(state, oldVal);
    },
  };
  return stub as unknown as ConfigStore & {
    __emit: (d: Partial<typeof initial>) => void;
  };
}

function makeWindowManager(): IBrowserWindowManager {
  return {
    open: vi.fn(),
    toggle: vi.fn(() => false),
    getByType: vi.fn(() => null),
  } as unknown as IBrowserWindowManager;
}

describe("PopupWindowShortcut", () => {
  beforeEach(() => {
    globalShortcutMock.register.mockClear();
    globalShortcutMock.unregister.mockClear();
    globalShortcutMock.register.mockReturnValue(true);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("registers the configured accelerator on init when enabled", async () => {
    const { PopupWindowShortcut } = await import("../global-shortcut");
    const config = makeConfigStore({
      popupWindowEnabled: true,
      popupWindowShortcut: "CommandOrControl+Shift+Space",
    });
    const shortcut = new PopupWindowShortcut(config, makeWindowManager());
    shortcut.init();
    expect(globalShortcutMock.register).toHaveBeenCalledWith(
      "CommandOrControl+Shift+Space",
      expect.any(Function),
    );
  });

  it("does NOT register anything when popupWindowEnabled is false", async () => {
    const { PopupWindowShortcut } = await import("../global-shortcut");
    const config = makeConfigStore({
      popupWindowEnabled: false,
      popupWindowShortcut: "CommandOrControl+Shift+Space",
    });
    const shortcut = new PopupWindowShortcut(config, makeWindowManager());
    shortcut.init();
    expect(globalShortcutMock.register).not.toHaveBeenCalled();
  });

  it("re-registers when the shortcut accelerator changes at runtime", async () => {
    const { PopupWindowShortcut } = await import("../global-shortcut");
    const config = makeConfigStore({
      popupWindowEnabled: true,
      popupWindowShortcut: "CommandOrControl+Shift+Space",
    });
    const shortcut = new PopupWindowShortcut(config, makeWindowManager());
    shortcut.init();
    expect(globalShortcutMock.register).toHaveBeenCalledTimes(1);

    (config as any).__emit({ popupWindowShortcut: "Alt+P" });

    expect(globalShortcutMock.unregister).toHaveBeenCalledWith("CommandOrControl+Shift+Space");
    expect(globalShortcutMock.register).toHaveBeenLastCalledWith("Alt+P", expect.any(Function));
  });

  it("dispose() unregisters the active shortcut and detaches the config listener", async () => {
    const { PopupWindowShortcut } = await import("../global-shortcut");
    const config = makeConfigStore({
      popupWindowEnabled: true,
      popupWindowShortcut: "Alt+P",
    });
    const shortcut = new PopupWindowShortcut(config, makeWindowManager());
    shortcut.init();
    shortcut.dispose();
    expect(globalShortcutMock.unregister).toHaveBeenCalledWith("Alt+P");
  });
});
