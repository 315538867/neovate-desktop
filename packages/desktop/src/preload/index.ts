import { electronAPI } from "@electron-toolkit/preload";
import debug from "debug";
import { contextBridge, ipcRenderer } from "electron";

const log = debug("neovate:orpc:preload");

/**
 * Trusted origins for the renderer's `start-orpc-client` handshake.
 *
 * - `file://` is the production renderer (loaded via `loadFile`). When a page
 *   is loaded from the filesystem, browsers report `event.origin` as the
 *   string `"null"` (not an empty string, not `"file://"`). We treat this as
 *   trusted because `event.source === window` is the real forgery-prevention
 *   — `source` always reflects the actual posting `Window`, which iframes and
 *   webviews cannot forge.
 * - In dev, `electron-vite` serves the renderer at `http://localhost:<port>`.
 */
const isTrustedHandshakeEvent = (event: MessageEvent): boolean => {
  if (event.source !== window) return false;
  // file:// pages report origin as the string "null" — this is the production path.
  if (event.origin === "null") return true;
  if (event.origin === "") return false;
  try {
    const { protocol, hostname } = new URL(event.origin);
    if (protocol === "file:") return true;
    if (protocol === "http:" || protocol === "https:") {
      return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
    }
    return false;
  } catch {
    return false;
  }
};

window.addEventListener("message", (event) => {
  if (event.data !== "start-orpc-client") return;
  if (!isTrustedHandshakeEvent(event)) {
    log("rejected start-orpc-client from untrusted origin: %s", event.origin);
    return;
  }
  const [serverPort] = event.ports;
  if (!serverPort) {
    log("rejected start-orpc-client: missing port");
    return;
  }
  log("forwarding start-orpc-server");
  ipcRenderer.postMessage("start-orpc-server", null, [serverPort]);
});

// API for renderer process (menu commands, etc.)
const api = {
  // homedir is fetched synchronously from main once per renderer init.
  // sandbox=true forbids `node:os` in preload, so we round-trip via IPC.
  homedir: ipcRenderer.sendSync("app:get-homedir") as string,
  isDev: !!process.defaultApp,
  onOpenSettings: (callback: () => void) => {
    ipcRenderer.on("menu:open-settings", callback);
    return () => ipcRenderer.removeListener("menu:open-settings", callback);
  },
  onPopupWindowShown: (callback: () => void) => {
    ipcRenderer.on("popup-window:shown", callback);
    return () => ipcRenderer.removeListener("popup-window:shown", callback);
  },
  onFullScreenChange: (callback: (isFullScreen: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isFullScreen: boolean) => {
      callback(isFullScreen);
    };
    ipcRenderer.on("window:fullscreen-change", handler);
    return () => ipcRenderer.removeListener("window:fullscreen-change", handler);
  },
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.api = api;
}
