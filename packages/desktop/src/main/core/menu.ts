import { BrowserWindow, Menu, MenuItemConstructorOptions, app } from "electron";

import type { IUpdateService } from "../../shared/features/updater/types";
import type { ConfigStore } from "../features/config/config-store";

import { APP_NAME } from "../../shared/constants";

const isDev = !app.isPackaged;

type MenuLocale = "zh-CN" | "en-US";

type MenuStrings = {
  about: (name: string) => string;
  settings: string;
  file: string;
  edit: string;
  view: string;
  window: string;
  checkForUpdates: string;
  checkingForUpdates: string;
  downloadingUpdate: string;
  restartToUpdate: string;
};

const STRINGS: Record<MenuLocale, MenuStrings> = {
  "en-US": {
    about: (name) => `About ${name}`,
    settings: "Settings",
    file: "File",
    edit: "Edit",
    view: "View",
    window: "Window",
    checkForUpdates: "Check for Updates",
    checkingForUpdates: "Checking for Updates\u2026",
    downloadingUpdate: "Downloading Update\u2026",
    restartToUpdate: "Restart to Update",
  },
  "zh-CN": {
    about: (name) => `关于 ${name}`,
    settings: "设置",
    file: "文件",
    edit: "编辑",
    view: "视图",
    window: "窗口",
    checkForUpdates: "检查更新",
    checkingForUpdates: "正在检查更新\u2026",
    downloadingUpdate: "正在下载更新\u2026",
    restartToUpdate: "重启以安装更新",
  },
};

function resolveLocale(pref: string | undefined): MenuLocale {
  if (pref === "zh-CN" || pref === "en-US") return pref;
  // "system" or unknown — derive from OS locale
  const sys = app.getLocale().toLowerCase();
  return sys.startsWith("zh") ? "zh-CN" : "en-US";
}

export class ApplicationMenu {
  private updateService: IUpdateService;
  private configStore: ConfigStore;
  private willShutdown = false;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeUpdate: (() => void) | null = null;
  private unsubscribeLocale: (() => void) | null = null;

  // Keep old menus around to prevent GC crash (Electron bug)
  // https://github.com/electron/electron/issues/55347
  private oldMenus: Menu[] = [];
  private gcTimer: ReturnType<typeof setTimeout> | null = null;

  private onBeforeQuit = (): void => {
    this.willShutdown = true;
  };

  constructor(updateService: IUpdateService, configStore: ConfigStore) {
    this.updateService = updateService;
    this.configStore = configStore;
    this.unsubscribeUpdate = this.updateService.onStateChange(() => this.scheduleRebuild());
    this.unsubscribeLocale = this.configStore.onChange("locale", () => this.scheduleRebuild());
    app.on("before-quit", this.onBeforeQuit);
    this.build();
  }

  dispose(): void {
    this.unsubscribeUpdate?.();
    this.unsubscribeUpdate = null;
    this.unsubscribeLocale?.();
    this.unsubscribeLocale = null;
    app.off("before-quit", this.onBeforeQuit);
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
    if (this.gcTimer) {
      clearTimeout(this.gcTimer);
      this.gcTimer = null;
    }
    this.oldMenus = [];
  }

  private scheduleRebuild(): void {
    if (this.rebuildTimer) return;
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      if (!this.willShutdown) {
        // Delay slightly to avoid rebuilding while menu is open
        setTimeout(() => {
          if (!this.willShutdown) this.build();
        }, 10);
      }
    }, 0);
  }

  private build(): void {
    const oldMenu = Menu.getApplicationMenu();
    if (oldMenu) {
      this.oldMenus.push(oldMenu);
      this.scheduleGC();
    }

    const isMac = process.platform === "darwin";
    const localePref = this.configStore.get("locale") as string | undefined;
    const s = STRINGS[resolveLocale(localePref)];

    const openSettings = (): void => {
      BrowserWindow.getFocusedWindow()?.webContents.send("menu:open-settings");
    };

    const template: MenuItemConstructorOptions[] = [
      ...(isMac
        ? [
            {
              label: APP_NAME,
              submenu: [
                { label: s.about(APP_NAME), click: () => app.showAboutPanel() },
                ...this.getUpdateMenuItems(s),
                { type: "separator" as const },
                { label: s.settings, accelerator: "CmdOrCtrl+,", click: openSettings },
                { type: "separator" as const },
                { role: "hide" as const },
                { role: "hideOthers" as const },
                { role: "unhide" as const },
                { type: "separator" as const },
                { role: "quit" as const },
              ],
            },
          ]
        : [
            {
              label: s.file,
              submenu: [
                { label: s.settings, accelerator: "CmdOrCtrl+,", click: openSettings },
                { type: "separator" as const },
                { role: "quit" as const },
              ],
            },
          ]),
      {
        label: s.edit,
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: s.view,
        submenu: [
          ...(isDev
            ? [
                { role: "reload" as const },
                { role: "forceReload" as const },
                { type: "separator" as const },
              ]
            : []),
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
          { type: "separator" },
          { role: "toggleDevTools" },
        ],
      },
      {
        label: s.window,
        submenu: [
          { role: "minimize" },
          { role: "close" },
          ...(isMac
            ? [
                { role: "zoom" as const },
                { type: "separator" as const },
                { role: "front" as const },
              ]
            : []),
        ],
      },
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }

  private getUpdateMenuItems(s: MenuStrings): MenuItemConstructorOptions[] {
    const state = this.updateService.state;

    switch (state.status) {
      case "idle":
      case "up-to-date":
      case "error":
        return [{ label: s.checkForUpdates, click: () => this.updateService.check(true) }];

      case "checking":
        return [{ label: s.checkingForUpdates, enabled: false }];

      case "downloading":
        return [{ label: s.downloadingUpdate, enabled: false }];

      case "ready":
        return [{ label: s.restartToUpdate, click: () => this.updateService.install() }];

      default:
        return [];
    }
  }

  private scheduleGC(): void {
    if (this.gcTimer) return;
    this.gcTimer = setTimeout(() => {
      this.oldMenus = [];
      this.gcTimer = null;
    }, 10_000);
  }
}
