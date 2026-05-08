import debug from "debug";

import type {
  SlashCommandInfo,
  ModelInfo,
  ModelScope,
  PermissionMode,
} from "../../../../shared/features/agent/types";

import { useConfigStore } from "../config/store";
import { useAgentStore } from "./store";

const log = debug("neovate:session-utils");

/**
 * Check whether a session's cwd belongs to the given project path.
 *
 * Uses `cwd === projectPath || cwd.startsWith(projectPath + "/")` instead
 * of a bare `startsWith` so that `/Volumes/code/foo` does not incorrectly
 * match sessions from `/Volumes/code/foo-bar`.
 */
export function isSessionInProject(cwd: string | undefined, projectPath: string): boolean {
  if (!cwd) return false;
  return cwd === projectPath || cwd.startsWith(projectPath + "/");
}

/** Find any existing isNew session for the given project path. */
export function findPreWarmedSession(projectPath: string): string | null {
  const { sessions } = useAgentStore.getState();
  for (const [id, session] of sessions) {
    if (session.isNew && isSessionInProject(session.cwd, projectPath)) {
      return id;
    }
  }
  return null;
}

/** Register a newly-created SDK session in the agent store. */
export function registerSessionInStore(
  sessionId: string,
  projectPath: string,
  capabilities: {
    commands?: SlashCommandInfo[];
    models?: ModelInfo[];
    currentModel?: string;
    modelScope?: ModelScope;
    providerId?: string;
    permissionMode?: PermissionMode;
  },
  activate: boolean,
) {
  log(
    "registerSessionInStore: sessionId=%s projectPath=%s activate=%s model=%s",
    sessionId,
    projectPath,
    activate,
    capabilities.currentModel,
  );
  const store = useAgentStore.getState();
  if (activate) {
    store.createSession(sessionId, { cwd: projectPath, isNew: true });
  } else {
    store.createBackgroundSession(sessionId, { cwd: projectPath, isNew: true });
  }
  if (capabilities.commands?.length) store.setAvailableCommands(sessionId, capabilities.commands);
  if (capabilities.models?.length) store.setAvailableModels(sessionId, capabilities.models);
  if (capabilities.currentModel) store.setCurrentModel(sessionId, capabilities.currentModel);
  if (capabilities.modelScope) store.setModelScope(sessionId, capabilities.modelScope);
  if (capabilities.providerId) store.setProviderId(sessionId, capabilities.providerId);
  const permissionMode = capabilities.permissionMode ?? useConfigStore.getState().permissionMode;
  store.setPermissionMode(sessionId, permissionMode);
}
