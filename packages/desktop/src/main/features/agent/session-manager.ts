import type { Query } from "@anthropic-ai/claude-agent-sdk";

import { EventPublisher } from "@orpc/server";
import debug from "debug";

import type {
  ClaudeCodeUIEvent,
  ClaudeCodeUIMessage,
  ClaudeCodeUIDispatch,
  ClaudeCodeUIDispatchResult,
} from "../../../shared/claude-code/types";
import type {
  ActiveSessionInfo,
  ModelScope,
  RewindFilesResult,
  RewindResult,
  SessionInfo,
  SessionLifecycleEvent,
} from "../../../shared/features/agent/types";
import type { Contributions } from "../../core/plugin/contributions";
import type { ConfigStore } from "../config/config-store";
import type { GroupService } from "../project/group-service";
import type { ProjectStore } from "../project/project-store";
import type { RequestTracker } from "./request-tracker";
import type { SessionEntry } from "./session/types";
import type { GroupMemberSnapshot } from "./session/types";

import { PowerBlockerService } from "../../core/power-blocker-service";
import { closeSession as closeSessionFn, type CloseContext } from "./session/close";
import {
  buildSessionContexts,
  type SessionContexts,
  type SessionContextsDeps,
} from "./session/ctx-builder";
import { handleDispatch as handleDispatchFn, type DispatchContext } from "./session/dispatch";
import {
  createSession as createSessionFn,
  type CreateSessionParams,
  type FacadeContext,
  loadSession as loadSessionFn,
} from "./session/facade";
import {
  type ForkContext,
  forkSession as forkSessionFn,
  rewindToMessage as rewindToMessageFn,
} from "./session/fork";
import { buildQueryOptions } from "./session/init";
import {
  lastTurnDiff as lastTurnDiffFn,
  lastTurnFiles as lastTurnFilesFn,
  rewindFilesDryRun as rewindFilesDryRunFn,
} from "./session/rewind-fork";
import { sendUserMessage, type SendContext } from "./session/send";
import {
  appendCustomTitle,
  archiveSessionFiles,
  deleteSessionFiles,
  listAllSessions,
} from "./session/store";
import { consumeSession } from "./session/subscriber";

const log = debug("neovate:session-manager");
const rtkLog = debug("neovate:rtk");

export class SessionManager {
  // Single global publisher — sessionId is the channel key
  readonly eventPublisher = new EventPublisher<Record<string, ClaudeCodeUIEvent>>();

  // Per-session state
  private sessions = new Map<string, SessionEntry>();

  private lifecycleListeners: Array<(event: SessionLifecycleEvent) => void> = [];
  private emittedCreatedSessions = new Set<string>();
  private closingSessions = new Set<string>();

  /** Group metadata captured from sessions before they are closed (for archive). */
  private pendingArchiveMeta = new Map<
    string,
    {
      kind?: string;
      groupId?: string;
      groupMembers?: GroupMemberSnapshot[];
    }
  >();

  // Bundles of manager-owned state passed to session helpers.
  // Built once in constructor; closures hold `this` so callbacks always
  // dispatch to the live manager instance. `initContext` is intentionally
  // not stored — `facadeContext` already references it, and the manager
  // never dispatches against it directly.
  private readonly sendContext: SendContext;
  private readonly dispatchContext: DispatchContext;
  private readonly closeContext: CloseContext;
  private readonly facadeContext: FacadeContext;
  private readonly forkContext: ForkContext;

  constructor(
    private configStore: ConfigStore,
    private projectStore: ProjectStore,
    private requestTracker: RequestTracker,
    private powerBlocker: PowerBlockerService,
    private groupService: GroupService,
    private getAgentContributions: () => Contributions["agents"] = () => [],
  ) {
    const deps: SessionContextsDeps = {
      sessions: this.sessions,
      emittedCreatedSessions: this.emittedCreatedSessions,
      closingSessions: this.closingSessions,
      configStore: this.configStore,
      projectStore: this.projectStore,
      groupService: this.groupService,
      requestTracker: this.requestTracker,
      powerBlocker: this.powerBlocker,
      eventPublisher: this.eventPublisher,
      getAgentContributions: () => this.getAgentContributions(),
      closeSession: (id) => this.closeSession(id),
      createSession: (cwd) => this.createSession({ cwd }),
      emitLifecycle: (event) => this.emitLifecycle(event),
      startConsume: (id) => {
        this.consume(id).catch((err) => log("consume error for %s: %o", id, err));
      },
      restartConsume: (id) => this.restartConsume(id),
      log,
      rtkLog,
    };
    const contexts: SessionContexts = buildSessionContexts(deps);
    this.sendContext = contexts.sendContext;
    this.dispatchContext = contexts.dispatchContext;
    this.closeContext = contexts.closeContext;
    this.facadeContext = contexts.facadeContext;
    this.forkContext = contexts.forkContext;
  }

  onLifecycle(listener: (event: SessionLifecycleEvent) => void): () => void {
    this.lifecycleListeners.push(listener);
    return () => {
      this.lifecycleListeners = this.lifecycleListeners.filter((l) => l !== listener);
    };
  }

  private emitLifecycle(event: SessionLifecycleEvent): void {
    for (const listener of this.lifecycleListeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /** Return all in-memory (active) sessions. */
  getActiveSessions(): ActiveSessionInfo[] {
    return Array.from(this.sessions.entries()).map(([sessionId, session]) => ({
      sessionId,
      cwd: session.cwd,
      createdAt: session.createdAt,
      model: session.model,
      providerId: session.providerId,
      kind: session.kind,
      groupId: session.groupId,
      elevatedProjectIds: session.elevatedProjectIds ? [...session.elevatedProjectIds] : undefined,
    }));
  }

  /**
   * Return active sessions belonging to a given group.
   */
  listActiveByGroup(groupId: string): { sessionId: string; title?: string }[] {
    const results: { sessionId: string; title?: string }[] = [];
    for (const [sessionId, session] of this.sessions) {
      if (session.kind === "group" && session.groupId === groupId) {
        results.push({ sessionId });
      }
    }
    return results;
  }

  /**
   * Return active sessions where a given project is the focus or a member.
   */
  listSessionsByMember(projectId: string): { sessionId: string; groupId: string }[] {
    const results: { sessionId: string; groupId: string }[] = [];
    for (const [sessionId, session] of this.sessions) {
      if (session.kind === "group" && session.groupId) {
        if (session.groupMembers?.some((m) => m.projectId === projectId)) {
          results.push({ sessionId, groupId: session.groupId });
        }
      }
    }
    return results;
  }

  /**
   * Called when a group's definition changes (members added/removed, roles
   * updated, group renamed). Refreshes the groupMembers snapshot on every
   * active session for that group and enqueues a hint so the AI learns
   * about the change on the next user message.
   */
  onGroupChanged(groupId: string): void {
    const group = this.groupService.getGroup(groupId);
    if (!group) return;

    const expanded = this.groupService.expandMembers(group);

    for (const [sessionId, session] of this.sessions) {
      if (session.kind === "group" && session.groupId === groupId) {
        session.groupMembers = expanded;

        session.pendingHint = `分组成员已更新：${expanded.map((m) => `${m.name} (${m.role})`).join("、")}。`;
        log("onGroupChanged: refreshed snapshot for sessionId=%s", sessionId);
      }
    }
  }

  /** Start a new session. */
  async createSession(params: CreateSessionParams): Promise<
    {
      sessionId: string;
      currentModel?: string;
      modelScope?: ModelScope;
      providerId?: string;
    } & Awaited<ReturnType<Query["initializationResult"]>>
  > {
    return createSessionFn(this.facadeContext, params);
  }

  /** Resume an existing session, returning converted historical messages. */
  async loadSession(
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
    return loadSessionFn(this.facadeContext, sessionId, cwd);
  }

  async listSessions(cwd?: string): Promise<SessionInfo[]> {
    return listAllSessions(cwd, log);
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    log("renameSession: sessionId=%s title=%s", sessionId, title);
    await appendCustomTitle(sessionId, title);
    log("renameSession: DONE sessionId=%s", sessionId);
  }

  getSessionCwd(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    return session.cwd;
  }

  getSessionProviderId(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.providerId;
  }

  async closeSession(sessionId: string): Promise<void> {
    return closeSessionFn(this.closeContext, sessionId);
  }

  async closeAll(): Promise<void> {
    log("closeAll: START sessions=%d", this.sessions.size);
    for (const sessionId of this.sessions.keys()) {
      await this.closeSession(sessionId);
    }
    log("closeAll: DONE");
  }

  /** Get the list of files changed in the last agent turn. */
  async lastTurnFiles(sessionId: string): Promise<RewindFilesResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    return lastTurnFilesFn(session);
  }

  /** Get the diff for a single file changed in the last agent turn. */
  async lastTurnDiff(
    sessionId: string,
    file: string,
  ): Promise<{
    success: boolean;
    data?: { oldContent: string; newContent: string };
    error?: string;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    return lastTurnDiffFn(session, file);
  }

  /** Dry-run: get the list of files that would change if we rewound to this message. */
  async rewindFilesDryRun(sessionId: string, messageId: string): Promise<RewindFilesResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    return rewindFilesDryRunFn(session, messageId);
  }

  /**
   * Rewind to a specific user message: optionally restore files, then fork the
   * conversation so the SDK's in-memory state matches the truncated history.
   */
  async rewindToMessage(
    sessionId: string,
    messageId: string,
    restoreFiles: boolean,
    title?: string,
  ): Promise<RewindResult> {
    // Capture group metadata before the session is closed by rewindToMessageFn
    const session = this.sessions.get(sessionId);
    if (session?.kind === "group") {
      this.pendingArchiveMeta.set(sessionId, {
        kind: session.kind,
        groupId: session.groupId,
        groupMembers: session.groupMembers,
      });
    }
    return rewindToMessageFn(this.forkContext, sessionId, messageId, restoreFiles, title);
  }

  /**
   * Fork an entire session: create a new session with all conversation history.
   * Works for both active (in-memory) and persisted-only (cold) sessions.
   */
  async forkSession(
    sessionId: string,
    cwd: string,
    title?: string,
  ): Promise<{ forkedSessionId: string; originalSessionId: string }> {
    return forkSessionFn(this.forkContext, sessionId, cwd, title);
  }

  /** Delete a session's .jsonl file from disk. */
  async deleteSessionFile(sessionId: string): Promise<void> {
    await deleteSessionFiles(sessionId, log);

    const now = new Date().toISOString();
    this.emitLifecycle({
      type: "deleted",
      session: { sessionId, createdAt: now, updatedAt: now },
    });
  }

  /**
   * Back up a session's .jsonl to ~/.neovate-desktop/rewind-history/ then delete the original.
   * Backup is atomic: delete only runs after the copy succeeds.
   */
  async archiveSessionFile(
    sessionId: string,
    meta: {
      forkedSessionId: string;
      rewindMessageId: string;
      restoreFiles: boolean;
      title?: string;
      cwd?: string;
    },
  ): Promise<void> {
    const pending = this.pendingArchiveMeta.get(sessionId);
    if (pending) {
      this.pendingArchiveMeta.delete(sessionId);
    }
    await archiveSessionFiles(sessionId, { ...meta, ...pending }, log);
  }

  /**
   * Send a user message into the session's input Pushable.
   * Does NOT consume the query iterator — that is handled by consume().
   */
  async send(sessionId: string, message: ClaudeCodeUIMessage): Promise<void> {
    return sendUserMessage(this.sendContext, sessionId, message);
  }

  /**
   * Restart a session's consume loop when it has exited (e.g. SDK stream error).
   * Creates a new SDK Query with `resume` to reconnect to the same session,
   * preserving all conversation history. Uses the existing input Pushable so
   * no messages are lost.
   */
  private async restartConsume(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.consumeExited) return;

    const { cwd, model, kind, groupMembers } = session;

    // Build fresh query options (canUseTool, permissions, etc.)
    const queryOpts = buildQueryOptions(this.facadeContext.initContext, {
      sessionId,
      cwd,
      model,
      kind,
      groupMembers,
    });

    log("restartConsume: creating new query sessionId=%s", sessionId);

    // Create new Query with resume — reuse existing input Pushable
    const { query: queryFn } = await import("@anthropic-ai/claude-agent-sdk");
    const q = queryFn({
      prompt: session.input,
      options: { ...queryOpts, resume: sessionId },
    });

    log("restartConsume: awaiting initializationResult sessionId=%s", sessionId);
    await q.initializationResult();
    log("restartConsume: DONE sessionId=%s", sessionId);

    // Only update state after initialization succeeds — if it throws, the
    // session stays in consumeExited state so the next send retries recovery.
    session.query = q;
    session.consumeExited = false;

    // Fire-and-forget the new consume loop
    this.consume(sessionId).catch((err) => log("restart consume error for %s: %o", sessionId, err));
  }

  /**
   * Long-lived background loop that consumes the query iterator and publishes
   * all events and chunks through the eventPublisher.
   * Started fire-and-forget after initSession(). Does NOT break on result —
   * continues through background turns.
   */
  private async consume(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await consumeSession({
      sessionId,
      session,
      eventPublisher: this.eventPublisher,
      powerBlocker: this.powerBlocker,
    });
  }

  /** Handle dispatch — respond to permission request or configure session */
  async handleDispatch(
    sessionId: string,
    dispatch: ClaudeCodeUIDispatch,
  ): Promise<ClaudeCodeUIDispatchResult> {
    return handleDispatchFn(this.dispatchContext, sessionId, dispatch);
  }
}
