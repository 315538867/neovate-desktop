import debug from "debug";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ModelScope } from "../../../shared/features/agent/types";
import type { Provider } from "../../../shared/features/provider/types";
import type { ConfigStore } from "../config/config-store";
import type { ProjectStore } from "../project/project-store";

import { APP_DATA_DIR } from "../../core/app-paths";

const log = debug("neovate:claude-settings");

const SESSIONS_DIR = join(APP_DATA_DIR, "sessions");

function sessionConfigPath(sessionId: string): string {
  return join(SESSIONS_DIR, `${sessionId}.json`);
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

async function writeJsonFile(filePath: string, data: Record<string, unknown>): Promise<void> {
  const dir = join(filePath, "..");
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * Read the effective model for a session.
 * Priority:
 *   1. ~/.neovate-desktop/sessions/<sessionId>.json  (session-scoped)
 *   2. <cwd>/.claude/settings.local.json             (project-scoped)
 *   3. ~/.claude/settings.json                       (global)
 */
export async function readModelSetting(
  sessionId: string,
  cwd: string,
): Promise<{ model: string; scope: ModelScope } | undefined> {
  // 1. Session-scoped
  const sessionJson = await readJsonFile(sessionConfigPath(sessionId));
  if (typeof sessionJson?.model === "string" && sessionJson.model) {
    log("readModelSetting: session scope model=%s sid=%s", sessionJson.model, sessionId);
    return { model: sessionJson.model, scope: "session" };
  }

  // 2. Project-scoped
  const projectJson = await readJsonFile(join(cwd, ".claude", "settings.local.json"));
  if (typeof projectJson?.model === "string" && projectJson.model) {
    log("readModelSetting: project scope model=%s cwd=%s", projectJson.model, cwd);
    return { model: projectJson.model, scope: "project" };
  }

  // 3. Global
  const globalJson = await readJsonFile(join(homedir(), ".claude", "settings.json"));
  // "default" is not a real model ID — ignore it (same as unset)
  if (typeof globalJson?.model === "string" && globalJson.model && globalJson.model !== "default") {
    log("readModelSetting: global scope model=%s", globalJson.model);
    return { model: globalJson.model, scope: "global" };
  }

  return undefined;
}

/**
 * Write (or remove) a model setting at the given scope.
 * Pass `null` to remove the model key (e.g. "Clear session override").
 */
export async function writeModelSetting(
  scope: ModelScope,
  model: string | null,
  opts: { sessionId?: string; cwd?: string },
): Promise<void> {
  switch (scope) {
    case "session": {
      if (!opts.sessionId) throw new Error("sessionId required for session scope");
      const filePath = sessionConfigPath(opts.sessionId);
      if (model === null) {
        try {
          await unlink(filePath);
          log("writeModelSetting: removed session config sid=%s", opts.sessionId);
        } catch {
          // File didn't exist — no-op
        }
        return;
      }
      const existing = (await readJsonFile(filePath)) ?? {};
      await writeJsonFile(filePath, { ...existing, model });
      log("writeModelSetting: session scope model=%s sid=%s", model, opts.sessionId);
      break;
    }
    case "project": {
      if (!opts.cwd) throw new Error("cwd required for project scope");
      const filePath = join(opts.cwd, ".claude", "settings.local.json");
      const existing = (await readJsonFile(filePath)) ?? {};
      if (model === null) {
        delete existing.model;
      } else {
        existing.model = model;
      }
      await writeJsonFile(filePath, existing);
      log("writeModelSetting: project scope model=%s cwd=%s", model, opts.cwd);
      break;
    }
    case "global": {
      const filePath = join(homedir(), ".claude", "settings.json");
      const existing = (await readJsonFile(filePath)) ?? {};
      // "default" is the SDK alias for "use default model" — not a real model ID.
      // Writing it to settings.json breaks Claude Code CLI.
      const effectiveModel = model === "default" ? null : model;
      if (effectiveModel === null) {
        delete existing.model;
      } else {
        existing.model = effectiveModel;
      }
      await writeJsonFile(filePath, existing);
      log("writeModelSetting: global scope model=%s", effectiveModel);
      break;
    }
  }
}

/**
 * Resolve the active provider for a session.
 * Priority: session -> project -> global.
 * Skips nonexistent or disabled providers.
 */
export async function readProviderSetting(
  sessionId: string,
  cwd: string,
  configStore: ConfigStore,
  projectStore: ProjectStore,
): Promise<{ provider: Provider; scope: ModelScope } | undefined> {
  // 1. Session-scoped
  const sessionJson = await readJsonFile(sessionConfigPath(sessionId));
  if (typeof sessionJson?.provider === "string" && sessionJson.provider) {
    const p = configStore.getProvider(sessionJson.provider);
    if (p?.enabled) {
      log("readProviderSetting: session scope provider=%s sid=%s", p.name, sessionId);
      return { provider: p, scope: "session" };
    }
  }

  // 2. Project-scoped
  const projectSel = projectStore.getProjectSelection(cwd);
  if (projectSel.provider) {
    const p = configStore.getProvider(projectSel.provider);
    if (p?.enabled) {
      log("readProviderSetting: project scope provider=%s cwd=%s", p.name, cwd);
      return { provider: p, scope: "project" };
    }
  }

  // 3. Global
  const globalSel = configStore.getGlobalSelection();
  if (globalSel.provider) {
    const p = configStore.getProvider(globalSel.provider);
    if (p?.enabled) {
      log("readProviderSetting: global scope provider=%s", p.name);
      return { provider: p, scope: "global" };
    }
  }

  return undefined;
}

/**
 * Write (or remove) a provider selection at the given scope.
 */
export async function writeProviderSetting(
  scope: ModelScope,
  providerId: string | null,
  opts: { sessionId?: string; cwd?: string },
  configStore: ConfigStore,
  projectStore: ProjectStore,
): Promise<void> {
  switch (scope) {
    case "session": {
      if (!opts.sessionId) throw new Error("sessionId required for session scope");
      const filePath = sessionConfigPath(opts.sessionId);
      const existing = (await readJsonFile(filePath)) ?? {};
      if (providerId === null) {
        delete existing.provider;
      } else {
        existing.provider = providerId;
      }
      await writeJsonFile(filePath, existing);
      log("writeProviderSetting: session scope provider=%s sid=%s", providerId, opts.sessionId);
      break;
    }
    case "project": {
      if (!opts.cwd) throw new Error("cwd required for project scope");
      projectStore.setProjectSelection(opts.cwd, providerId);
      log("writeProviderSetting: project scope provider=%s cwd=%s", providerId, opts.cwd);
      break;
    }
    case "global": {
      configStore.setGlobalSelection(providerId);
      log("writeProviderSetting: global scope provider=%s", providerId);
      break;
    }
  }
}

/**
 * Resolve model within a provider context.
 * Priority: session model -> project model -> global model -> provider.modelMap.model
 * Falls back to modelMap.model if resolved model is not in provider's catalog.
 */
export async function readProviderModelSetting(
  sessionId: string,
  cwd: string,
  provider: Provider,
  configStore: ConfigStore,
  projectStore: ProjectStore,
): Promise<{ model: string; scope: ModelScope }> {
  const fallback = provider.modelMap.model ?? Object.keys(provider.models)[0];

  // 1. Session-scoped model
  const sessionJson = await readJsonFile(sessionConfigPath(sessionId));
  if (typeof sessionJson?.model === "string" && sessionJson.model) {
    const model = sessionJson.model in provider.models ? sessionJson.model : fallback;
    return { model, scope: "session" };
  }

  // 2. Project-scoped model
  const projectSel = projectStore.getProjectSelection(cwd);
  if (projectSel.model) {
    const model = projectSel.model in provider.models ? projectSel.model : fallback;
    return { model, scope: "project" };
  }

  // 3. Global model
  const globalSel = configStore.getGlobalSelection();
  if (globalSel.model) {
    const model = globalSel.model in provider.models ? globalSel.model : fallback;
    return { model, scope: "global" };
  }

  // 4. Provider default
  return { model: fallback, scope: "global" };
}
