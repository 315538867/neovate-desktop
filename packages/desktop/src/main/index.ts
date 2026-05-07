import "./core/logger";
import { electronApp, is } from "@electron-toolkit/utils";
import { RPCHandler } from "@orpc/server/message-port";
import debug from "debug";
import { app, ipcMain, BrowserWindow } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";

import type { AppContext } from "./router";

import { isMac } from "../shared/platform";
import { MainApp } from "./app";
import { APP_DATA_DIR } from "./core/app-paths";
import { ApplicationMenu } from "./core/menu";
import { PowerBlockerService } from "./core/power-blocker-service";
import { shellEnvService } from "./core/shell-service";
import {
  BUILTIN_TEMPLATES,
  ChangeTracker,
  CheckpointManager,
  ClaudeCodeExecutor,
  ErrorStore,
  EventStore,
  ExecutorRegistry,
  LlmOnlyExecutor,
  Orchestrator,
  PartialOutputStore,
  RetryPolicy,
  RunStore,
  SubtaskTracker,
  TemplateRegistry,
  TraceEmitter,
  WorktreeManager,
} from "./features/agent-orchestrator";
import { RequestTracker } from "./features/agent/request-tracker";
import { SessionManager } from "./features/agent/session-manager";
import { PluginsService } from "./features/claude-code-plugins/plugins-service";
import { ConfigStore } from "./features/config/config-store";
import { LlmService } from "./features/llm/llm-service";
import { PopupWindowShortcut } from "./features/popup-window/global-shortcut";
import { ProjectStore } from "./features/project/project-store";
import { SkillsService } from "./features/skills/skills-service";
import { StateStore } from "./features/state/state-store";
import { UpdaterService } from "./features/updater/service";
import browserPlugin from "./plugins/browser";
import changesPlugin from "./plugins/changes";
// import demoMcpLivePreviewPlugin from "./plugins/demo-mcp-live-preview";
import editorPlugin from "./plugins/editor";
import filesPlugin from "./plugins/files";
import gitPlugin from "./plugins/git";
import terminalPlugin from "./plugins/terminal";

const log = debug("neovate:orpc");
const startupLog = debug("neovate:startup");
const t0 = performance.now();
const elapsed = () => `${Math.round(performance.now() - t0)}ms`;
startupLog("main process module loaded %s", elapsed());

if (is.dev && process.env.ELECTRON_CDP_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.ELECTRON_CDP_PORT);
}

// Each SDK session adds a process.on("exit") listener to kill its child process.
// Raise the limit so normal multi-session usage doesn't trigger a warning.
process.setMaxListeners(50);

// Eagerly warm the shell environment cache so it's ready before first session
shellEnvService.getEnv();

const configStore = new ConfigStore();
const projectStore = new ProjectStore();

// --- Crash loop detection (Section 1) ---
if (projectStore.checkCrashLoop()) {
  log("crash loop detected — clearing activeProjectId to break the loop");
  projectStore.setActive(null);
  projectStore.clearCrashCounter();
}

// Ensure the playground project + directory exist (idempotent)
projectStore.ensurePlayground();

process.on("uncaughtException", (error) => {
  log("uncaughtException: %O", error);
  projectStore.recordCrash();
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  // SDK query.close() rejects internal promises that can't be caught externally.
  // This is expected during rapid model switching or session teardown.
  if (reason instanceof Error && reason.message === "Query closed before response received") {
    console.warn("[neovate] suppressed SDK close rejection:", reason.message);
    return;
  }
  log("unhandledRejection: %O", reason);
  projectStore.recordCrash();
  process.exit(1);
});
const requestTracker = new RequestTracker();
const powerBlocker = new PowerBlockerService(configStore);
const sessionManager = new SessionManager(
  configStore,
  projectStore,
  requestTracker,
  powerBlocker,
  () => mainApp.pluginManager.contributions.agents,
);
const stateStore = new StateStore();
const llmService = new LlmService(configStore, shellEnvService);
const mainApp = new MainApp({
  appName: app.getName(),
  plugins: [
    gitPlugin,
    filesPlugin,
    terminalPlugin,
    editorPlugin,
    changesPlugin,
    browserPlugin,
    // demoMcpLivePreviewPlugin,
  ],
  llmService,
});
const updaterService = new UpdaterService({
  onBeforeQuitForUpdate: () => mainApp.windowManager.prepareForQuit(),
});
const pluginsService = new PluginsService();
const skillsService = new SkillsService(projectStore, configStore, process.resourcesPath);

// ── Orchestrator wiring ───────────────────────────────────────────
// Persistence stores share the app's StorageService, which scopes each
// namespace under APP_DATA_DIR. Worktrees live under their own subdir
// so manual cleanup (e.g. by power users) doesn't leak into other state.
const orchestratorStorage = mainApp.getStorage();
const orchestratorEventStore = new EventStore(orchestratorStorage);
const orchestratorRunStore = new RunStore(orchestratorStorage);
const orchestratorCheckpointManager = new CheckpointManager({
  storage: orchestratorStorage,
});
const orchestratorPartialOutputStore = new PartialOutputStore(orchestratorStorage);
const orchestratorErrorStore = new ErrorStore({ storage: orchestratorStorage });
const orchestratorTraceEmitter = new TraceEmitter({
  eventStore: orchestratorEventStore,
});
const orchestratorRetryPolicy = new RetryPolicy({});
const orchestratorWorktreeManager = new WorktreeManager({
  root: join(APP_DATA_DIR, "orchestrator", "worktrees"),
});
const orchestratorExecutorRegistry = new ExecutorRegistry();
orchestratorExecutorRegistry.register(new LlmOnlyExecutor(llmService));
orchestratorExecutorRegistry.register(new ClaudeCodeExecutor({ sessionManager }));
const orchestratorTemplateRegistry = new TemplateRegistry();
for (const tpl of BUILTIN_TEMPLATES) orchestratorTemplateRegistry.register(tpl);
const orchestratorChangeTracker = new ChangeTracker();
const orchestratorSubtaskTracker = new SubtaskTracker();

const orchestrator = new Orchestrator({
  runStore: orchestratorRunStore,
  eventStore: orchestratorEventStore,
  checkpointManager: orchestratorCheckpointManager,
  partialOutputStore: orchestratorPartialOutputStore,
  errorStore: orchestratorErrorStore,
  traceEmitter: orchestratorTraceEmitter,
  retryPolicy: orchestratorRetryPolicy,
  worktreeManager: orchestratorWorktreeManager,
  executorRegistry: orchestratorExecutorRegistry,
  templateRegistry: orchestratorTemplateRegistry,
  changeTracker: orchestratorChangeTracker,
  subtaskTracker: orchestratorSubtaskTracker,
});

const appContext: AppContext = {
  sessionManager,
  orchestrator,
  requestTracker,
  configStore,
  llmService,
  projectStore,
  pluginsService,
  skillsService,
  stateStore,
  updaterService,
  mainApp,
  storage: orchestratorStorage,
};

// Reset crash counter after 30s of stable uptime
setTimeout(() => projectStore.clearCrashCounter(), 30_000);

// ── Deeplink ──
// open-url at module level — critical for cold launch on macOS.
// Wave 4.3 commit 7.3: require user confirmation before dispatching the
// deeplink. External callers (browsers, OS apps) can trigger this without
// user intent, so we always show a modal first and only proceed on
// approval. Default-deny on timeout.
app.on("open-url", (event, url) => {
  event.preventDefault();
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.show();
    win.focus();
  }
  let parsedScheme = "";
  let parsedHost = "";
  try {
    const parsed = new URL(url);
    parsedScheme = parsed.protocol.replace(/:$/, "");
    parsedHost = parsed.hostname;
  } catch {
    // Malformed URL — let the deeplink service log + drop it without prompt.
    log("open-url: malformed URL, skipping confirm: %s", url);
    return;
  }
  void mainApp.deeplinkConfirmBus
    .request({ url, scheme: parsedScheme, host: parsedHost })
    .then((approved) => {
      if (approved) {
        mainApp.deeplink.handle(url);
      } else {
        log("deeplink rejected by user: %s", url);
      }
    });
});

// Register app-level deeplink handler before start()
mainApp.deeplink.register("session", {
  handle(ctx) {
    const sessionId = ctx.path.slice(1); // remove leading /
    const project = ctx.searchParams.get("project");
    if (!sessionId || !project) return null;
    // searchParams.get() already decodes — do not double-decode
    return { sessionId, project };
  },
});

let menu: ApplicationMenu | null = null;
let popupShortcut: PopupWindowShortcut | null = null;

startupLog("app.whenReady waiting %s", elapsed());
app.whenReady().then(async () => {
  startupLog("app.whenReady fired %s", elapsed());
  electronApp.setAppUserModelId("com.neovateai.desktop");

  // safeStorage may be unavailable (Linux without keychain, headless tests, etc).
  // Don't crash startup — the renderer surfaces a banner via
  // `client.config.getKeychainStatus()` so the user sees what's wrong, and
  // any encrypt/decrypt op will throw KeychainUnavailableError when reached.
  try {
    configStore.migrateApiKeys();
  } catch (err) {
    log("migrateApiKeys skipped: %O", err);
  }

  await mainApp.start();
  startupLog("mainApp.start done %s", elapsed());
  void updaterService.init();

  // Recover any runs left in `running` state from a previous unclean
  // shutdown. Rows older than the heuristic threshold flip to
  // `interrupted_unsafe`; everything else becomes `interrupted_graceful`
  // so the UI can prompt the user to resume / abort.
  try {
    const cleanup = orchestrator.startupCleanup();
    startupLog("orchestrator.startupCleanup marked=%d", cleanup.marked);
  } catch (err) {
    log("orchestrator.startupCleanup failed: %O", err);
  }

  // Setup application menu (for menu items, shortcuts handled in renderer)
  menu = new ApplicationMenu(updaterService, configStore);

  // Register global shortcut for popup window
  popupShortcut = new PopupWindowShortcut(configStore, mainApp.windowManager);
  popupShortcut.init();

  // Transport — Electron MessagePort. Swap for WS/HTTP in other environments.
  const handler = new RPCHandler(mainApp.router);
  ipcMain.removeAllListeners("start-orpc-server");
  ipcMain.on("start-orpc-server", (event) => {
    const [serverPort] = event.ports;
    log("start-orpc-server received, upgrading message port");
    handler.upgrade(serverPort, { context: appContext });
    serverPort.start();
  });

  // Sync homedir lookup for sandboxed preload (cannot import node:os).
  // Called once per renderer at preload load — sub-millisecond cost.
  ipcMain.removeAllListeners("app:get-homedir");
  ipcMain.on("app:get-homedir", (event) => {
    event.returnValue = homedir();
  });

  app.on("activate", () => {
    const win = mainApp.windowManager.mainWindow;
    if (!win) {
      mainApp.windowManager.createMainWindow();
    } else {
      win.show();
    }
  });

  // Cleanup handler — registered after mainApp.start() so the BWM's
  // quit-confirmation before-quit handler fires first (Electron preserves
  // listener registration order). The e.defaultPrevented guard ensures
  // cleanup only runs when the quit is actually proceeding.
  app.on("before-quit", (e) => {
    if (e.defaultPrevented) return;

    const qt0 = performance.now();
    const qel = (label: string) =>
      startupLog("QUIT %s %dms", label, Math.round(performance.now() - qt0));

    startupLog("QUIT before-quit fired");

    popupShortcut?.dispose();
    qel("popupShortcut.dispose");

    menu?.dispose();
    qel("menu.dispose");

    updaterService.dispose();
    qel("updaterService.dispose");

    powerBlocker.dispose();
    qel("powerBlocker.dispose");

    llmService.dispose();
    qel("llmService.dispose");

    const sessCount = sessionManager.getActiveSessions().length;
    startupLog("QUIT closing %d sessions", sessCount);

    void orchestrator
      .gracefulShutdown()
      .then(() => qel("orchestrator.gracefulShutdown DONE"))
      .catch((err: unknown) => log("orchestrator.gracefulShutdown failed: %O", err));
    void sessionManager.closeAll().then(() => qel("sessionManager.closeAll DONE"));
    void mainApp.stop().then(() => qel("mainApp.stop DONE"));
  });
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});
