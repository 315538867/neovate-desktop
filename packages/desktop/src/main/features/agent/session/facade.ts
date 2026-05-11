/**
 * Session lifecycle orchestrators — `createSession` and `loadSession`.
 *
 * Pulled out of `SessionManager` so the manager class stays focused on
 * orchestration. Each orchestrator walks the provider/model resolution
 * chain, then delegates to `initSessionWithTimeout` to bring up the SDK
 * Query. Behavior must remain bit-for-bit identical to the inlined
 * versions — pure relocation, not a redesign.
 *
 * Steps:
 *   - createSession: randomUUID → resolveProviderAndModelForCreate →
 *     initSessionWithTimeout → return { sessionId, currentModel,
 *     modelScope, providerId, ...sdkInitResult }.
 *   - loadSession: resolveProviderAndModelForLoad → run init +
 *     getSessionMessages in parallel → convert to UIMessages → return
 *     { sessionId, capabilities, messages, currentModel, modelScope,
 *       providerId }.
 */

import type { Query } from "@anthropic-ai/claude-agent-sdk";

import { randomUUID } from "node:crypto";

import type { ClaudeCodeUIMessage } from "../../../../shared/claude-code/types";
import type { ConversationKind, ModelScope } from "../../../../shared/features/agent/types";
import type { ConfigStore } from "../../config/config-store";
import type { GroupService } from "../../project/group-service";
import type { ProjectStore } from "../../project/project-store";
import type { InitContext } from "./init";
import type { GroupMemberSnapshot } from "./types";

import { sessionMessagesToUIMessages } from "../utils/session-messages-to-ui-messages";
import { initSessionWithTimeout } from "./init";
import { resolveProviderAndModelForCreate, resolveProviderAndModelForLoad } from "./resolve";

/**
 * Bundle of manager-owned state that the createSession/loadSession
 * orchestrators touch. `initContext` is reused by reference so the
 * underlying initSessionWithTimeout call reaches the live manager
 * sessions map and callbacks.
 */
export interface FacadeContext {
  configStore: ConfigStore;
  projectStore: ProjectStore;
  groupService: GroupService;
  initContext: InitContext;
  log: (fmt: string, ...args: unknown[]) => void;
}

export interface CreateSessionParams {
  cwd: string;
  model?: string;
  explicitProviderId?: string | null;
  kind?: ConversationKind;
  groupId?: string;
  focusProjectId?: string;
}

/** Start a new session. */
export async function createSession(
  ctx: FacadeContext,
  params: CreateSessionParams,
): Promise<
  {
    sessionId: string;
    currentModel?: string;
    modelScope?: ModelScope;
    providerId?: string;
  } & Awaited<ReturnType<Query["initializationResult"]>>
> {
  const { cwd, model, explicitProviderId, kind, groupId, focusProjectId } = params;
  const { configStore, projectStore, groupService, initContext, log } = ctx;
  const sessionId = randomUUID();

  // Resolve group context
  let groupMembers: GroupMemberSnapshot[] | undefined;
  let effectiveCwd = cwd;
  let effectiveKind: ConversationKind = kind ?? "single";
  let effectiveFocusProjectId = focusProjectId;

  if (effectiveKind === "group" && groupId && focusProjectId) {
    const group = groupService.getGroup(groupId);
    if (!group) {
      throw Object.assign(new Error(`Group not found: ${groupId}`), { code: "GROUP_NOT_FOUND" });
    }
    const expanded = groupService.expandMembers(group);
    groupMembers = expanded;

    // Validate focus project
    const focus = expanded.find((m) => m.projectId === focusProjectId);
    if (!focus) {
      throw Object.assign(new Error(`Focus project ${focusProjectId} not in group ${groupId}`), {
        code: "FOCUS_NOT_IN_GROUP",
      });
    }
    if (focus.missing) {
      throw Object.assign(new Error(`Focus project ${focus.name} path is missing`), {
        code: "FOCUS_PATH_MISSING",
      });
    }
    effectiveCwd = focus.path!;
  }

  log(
    "createSession: sessionId=%s kind=%s cwd=%s model=%s explicitProviderId=%s",
    sessionId,
    effectiveKind,
    effectiveCwd,
    model ?? "(auto)",
    explicitProviderId ?? "(none)",
  );

  const { provider, modelSetting } = await resolveProviderAndModelForCreate({
    sessionId,
    cwd: effectiveCwd,
    model,
    explicitProviderId,
    configStore,
    projectStore,
    log,
  });

  log(
    "createSession: resolved model=%s scope=%s providerId=%s",
    modelSetting?.model ?? "(default)",
    modelSetting?.scope ?? "(none)",
    provider?.id ?? "(none)",
  );

  const initResult = await initSessionWithTimeout(initContext, sessionId, effectiveCwd, {
    model: modelSetting?.model,
    provider,
    kind: effectiveKind,
    groupId,
    focusProjectId: effectiveFocusProjectId,
    groupMembers,
  });

  return {
    ...initResult,
    sessionId,
    currentModel: modelSetting?.model,
    modelScope: modelSetting?.scope,
    providerId: provider?.id,
  };
}

/** Resume an existing session, returning converted historical messages. */
export async function loadSession(
  ctx: FacadeContext,
  sessionId: string,
  cwd: string,
): Promise<{
  sessionId: string;
  capabilities: Awaited<ReturnType<Query["initializationResult"]>>;
  messages: ClaudeCodeUIMessage[];
  currentModel?: string;
  modelScope?: ModelScope;
  providerId?: string;
}> {
  const { configStore, projectStore, initContext, log } = ctx;

  const { provider, modelSetting } = await resolveProviderAndModelForLoad({
    sessionId,
    cwd,
    configStore,
    projectStore,
    log,
  });

  // Run SDK session init and on-disk message hydration in parallel:
  // they are independent (getSessionMessages just reads the .jsonl file
  // and does not require the resumed query to be live). This typically
  // shaves the smaller of the two off the perceived load latency.
  const { getSessionMessages } = await import("@anthropic-ai/claude-agent-sdk");
  const [capabilities, sessionMessages] = await Promise.all([
    initSessionWithTimeout(initContext, sessionId, cwd, {
      model: modelSetting?.model,
      resume: sessionId,
      provider,
    }),
    getSessionMessages(sessionId, { includeSystemMessages: true }),
  ]);
  const messages = await sessionMessagesToUIMessages(sessionMessages);

  log(
    "loadSession: sessionId=%s raw=%d messages=%d currentModel=%s modelScope=%s providerId=%s",
    sessionId,
    sessionMessages.length,
    messages.length,
    modelSetting?.model ?? "(default)",
    modelSetting?.scope ?? "(none)",
    provider?.id ?? "(none)",
  );

  return {
    sessionId,
    capabilities,
    messages,
    currentModel: modelSetting?.model,
    modelScope: modelSetting?.scope,
    providerId: provider?.id,
  };
}
