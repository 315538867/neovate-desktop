import debug from "debug";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

const log = debug("neovate:config");

import type { AppConfig } from "../../../../shared/features/config/types";

import { withReport } from "../../core/error-reporter";
import { DEFAULT_KEYBINDINGS, type KeybindingAction } from "../../lib/keybindings";
import { client } from "../../orpc";

type KeybindingsConfig = Record<KeybindingAction, string>;

interface ConfigState extends AppConfig {
  loaded: boolean;
  /**
   * Whether OS keychain (Electron `safeStorage`) can encrypt/decrypt right now.
   * `null` until the first `load()` resolves. When `false` the renderer surfaces
   * a global banner since credentials cannot be stored securely (Wave 4.3 commit 7.2).
   */
  keychainAvailable: boolean | null;
  load: () => Promise<void>;
  // Generic setter for any config field
  setConfig: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
  // Specialized setters for complex fields
  setKeybinding: (action: KeybindingAction, binding: string) => void;
  resetKeybindings: () => void;
}

const DEFAULT_CONFIG: AppConfig = {
  // General Settings
  theme: "system",
  themeStyle: "default",
  locale: "system",
  runOnStartup: false,
  multiProjectSupport: false,
  appFontSize: 14,
  terminalFontSize: 12,
  terminalFont: "",
  developerMode: false,
  showSessionInitStatus: false,
  claudeCodeBinPath: "",

  // Sidebar Settings (multi-project mode)
  sidebarOrganize: "byProject",
  sidebarSortBy: "created",

  // Chat Settings
  sendMessageWith: "enter",
  agentLanguage: "English",
  permissionMode: "default",
  notificationSound: "default",
  tokenOptimization: true,
  networkInspector: false,
  keepAwake: false,
  preWarmSessions: true,
  auxiliaryModelSelection: "",

  // Keybindings
  keybindings: {},

  // Popup Window
  popupWindowEnabled: true,
  popupWindowShortcut: "Alt+N",
  popupWindowStayOpen: true,

  // Skills
  skillsRegistries: [],
  npmRegistry: "",
};

export const useConfigStore = create<ConfigState>()(
  immer((set, get) => ({
    ...DEFAULT_CONFIG,
    loaded: false,
    keychainAvailable: null,

    load: async () => {
      log("loading config");
      // Fetch config + keychain status in parallel — both are read-only.
      // If `getKeychainStatus` itself throws (very unlikely; it just calls
      // `safeStorage.isEncryptionAvailable()`), treat that as unavailable
      // so the banner surfaces conservatively.
      const [config, keychainStatus] = await Promise.all([
        client.config.get(),
        client.config.getKeychainStatus().catch((err) => {
          log("getKeychainStatus failed: %O", err);
          return { available: false };
        }),
      ]);
      log("config loaded keychainAvailable=%s", keychainStatus.available);
      set((state) => {
        Object.assign(state, config);
        state.loaded = true;
        state.keychainAvailable = keychainStatus.available;
      });
    },

    // Generic setter - handles persistence automatically
    setConfig: (key, value) => {
      log("setConfig: key=%s", key, value);
      void withReport(client.config.set({ key, value } as any), {
        op: "config.set",
        key,
      });
      set({ [key]: value } as any);
    },

    // Specialized setter for keybindings (nested object)
    setKeybinding: (action, binding) => {
      log("setKeybinding: action=%s binding=%s", action, binding);
      set((state) => {
        state.keybindings[action] = binding;
      });
      void withReport(client.config.set({ key: "keybindings", value: get().keybindings }), {
        op: "config.setKeybinding",
        action,
      });
    },

    resetKeybindings: () => {
      log("resetKeybindings");
      const keybindings = { ...DEFAULT_KEYBINDINGS } as KeybindingsConfig;
      void withReport(client.config.set({ key: "keybindings", value: keybindings }), {
        op: "config.resetKeybindings",
      });
      set({ keybindings });
    },
  })),
);

// Convenience hooks for common config fields
export const useLocale = () => useConfigStore((s) => s.locale);
