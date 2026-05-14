/**
 * Dispatch handler — respond to permission requests, interrupt the
 * current turn, or configure a live session (set permission mode / model).
 *
 * Pulled out of `SessionManager.handleDispatch` so the manager class
 * stays focused on orchestration. Behavior is bit-for-bit identical to
 * the inlined version — pure relocation, not a redesign.
 */

import type { PermissionMode as SDKPermissionMode } from "@anthropic-ai/claude-agent-sdk";

import type {
  ClaudeCodeUIDispatch,
  ClaudeCodeUIDispatchResult,
} from "../../../../shared/claude-code/types";
import type { ConfigStore } from "../../config/config-store";
import type { SessionEntry } from "./types";

/**
 * Bundle of manager-owned state that handleDispatch touches. Same shape
 * pattern as InitContext / SendContext.
 */
export interface DispatchContext {
  sessions: Map<string, SessionEntry>;
  configStore: ConfigStore;
  log: (fmt: string, ...args: unknown[]) => void;
}

/** Handle dispatch — respond to permission request or configure session */
export async function handleDispatch(
  ctx: DispatchContext,
  sessionId: string,
  dispatch: ClaudeCodeUIDispatch,
): Promise<ClaudeCodeUIDispatchResult> {
  const { sessions, configStore, log } = ctx;

  if (dispatch.kind === "respond") {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    const pending = session.pendingRequests.get(dispatch.requestId);
    if (!pending) {
      log("handleDispatch: unknown requestId=%s knownIds=%o", dispatch.requestId, [
        ...session.pendingRequests.keys(),
      ]);
      return { kind: "respond", ok: false };
    }
    // 若 dispatch 带 elevation 且结果是 allow，先把 projectId 加入 elevated 集合
    if (dispatch.respond.elevation && dispatch.respond.result.behavior === "allow") {
      const set = session.elevatedProjectIds ?? new Set<string>();
      set.add(dispatch.respond.elevation.projectId);
      session.elevatedProjectIds = set;
      log(
        "handleDispatch: elevation granted sessionId=%s projectId=%s total=%d",
        sessionId,
        dispatch.respond.elevation.projectId,
        set.size,
      );
    }
    pending.resolve(dispatch.respond.result);
    session.pendingRequests.delete(dispatch.requestId);
    return { kind: "respond", ok: true };
  }

  if (dispatch.kind === "revoke_elevation") {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    if (session.elevatedProjectIds?.delete(dispatch.projectId)) {
      log(
        "handleDispatch: elevation revoked sessionId=%s projectId=%s remaining=%d",
        sessionId,
        dispatch.projectId,
        session.elevatedProjectIds.size,
      );
      return { kind: "revoke_elevation", ok: true };
    }
    return { kind: "revoke_elevation", ok: false };
  }

  if (dispatch.kind === "elevate_project") {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    if (session.kind !== "group") {
      return { kind: "elevate_project", ok: false };
    }
    const member = session.groupMembers?.find(
      (m) => m.projectId === dispatch.projectId && !m.missing,
    );
    if (!member) {
      return { kind: "elevate_project", ok: false };
    }
    const set = session.elevatedProjectIds ?? new Set<string>();
    set.add(dispatch.projectId);
    session.elevatedProjectIds = set;
    log(
      "handleDispatch: elevation granted sessionId=%s projectId=%s total=%d",
      sessionId,
      dispatch.projectId,
      set.size,
    );
    return { kind: "elevate_project", ok: true };
  }

  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Unknown session: ${sessionId}`);

  if (dispatch.kind === "interrupt") {
    log("handleDispatch: interrupt sessionId=%s", sessionId);
    session.query.interrupt();
    return { kind: "interrupt", ok: true };
  }

  if (dispatch.kind === "configure") {
    const { configure } = dispatch;
    log("handleDispatch: configure type=%s", configure.type);
    switch (configure.type) {
      case "set_permission_mode": {
        log("handleDispatch: set_permission_mode sessionId=%s mode=%s", sessionId, configure.mode);
        try {
          await session.query.setPermissionMode(configure.mode as SDKPermissionMode);
        } catch (error) {
          log("handleDispatch: set_permission_mode failed: %O", error);
          return {
            kind: "configure",
            ok: false,
            configure,
            error: error instanceof Error ? error.message : String(error),
          };
        }
        return { kind: "configure", ok: true, configure };
      }
      case "set_model": {
        let model = configure.model;
        // Validate model against provider catalog
        if (session.providerId) {
          const provider = configStore.getProvider(session.providerId);
          if (provider && !(model in provider.models)) {
            model = provider.modelMap.model ?? Object.keys(provider.models)[0];
            log("handleDispatch: set_model fallback model=%s (not in provider catalog)", model);
          }
        }
        log("handleDispatch: set_model sessionId=%s model=%s", sessionId, model);
        session.query.setModel(model);
        return { kind: "configure", ok: true, configure: { ...configure, model } };
      }
    }
  }

  return { kind: "configure", ok: false, configure: (dispatch as any).configure };
}
