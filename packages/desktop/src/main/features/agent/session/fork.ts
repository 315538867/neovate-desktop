/**
 * Cross-session fork orchestrators — `rewindToMessage` and `forkSession`.
 *
 * Pulled out of `SessionManager` so the manager class stays focused on
 * orchestration. Both methods coordinate work across multiple sessions
 * (read original state, possibly create or close, emit lifecycle), and
 * delegate the per-session helpers (resolveSdkMessageId, findPrevMessageId,
 * resolveForkLastMessageId) which already live in `./rewind-fork`.
 *
 * Behavior must remain bit-for-bit identical to the inlined versions —
 * pure relocation, not a redesign.
 *
 * Steps:
 *   - rewindToMessage: resolve UI→SDK uuid → optional file restore →
 *     find prev SDK message → SDK forkSession (or createSession when
 *     rewinding to first message) → close original session.
 *   - forkSession: resolve last SDK message id → SDK forkSession with
 *     "(Fork)" title suffix → emit lifecycle.created.
 */

import type { RewindResult, SessionLifecycleEvent } from "../../../../shared/features/agent/types";
import type { SessionEntry } from "./types";

import { findPrevMessageId, resolveForkLastMessageId, resolveSdkMessageId } from "./rewind-fork";

/**
 * Bundle of manager-owned state that the rewind/fork orchestrators
 * touch. `createSession` is needed as a callback because rewinding to
 * the first message creates a brand-new session via the public API
 * (which goes through the facade).
 */
export interface ForkContext {
  sessions: Map<string, SessionEntry>;
  closeSession: (sessionId: string) => Promise<void>;
  createSession: (cwd: string) => Promise<{ sessionId: string }>;
  emitLifecycle: (event: SessionLifecycleEvent) => void;
  log: (fmt: string, ...args: unknown[]) => void;
}

/**
 * Rewind to a specific user message: optionally restore files, then fork the
 * conversation so the SDK's in-memory state matches the truncated history.
 */
export async function rewindToMessage(
  ctx: ForkContext,
  sessionId: string,
  messageId: string,
  restoreFiles: boolean,
  title?: string,
): Promise<RewindResult> {
  const { sessions, closeSession, createSession, log } = ctx;

  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Unknown session: ${sessionId}`);
  const sdkMessageId = resolveSdkMessageId(session, messageId);

  // 1. Restore files if requested (on the ORIGINAL session, which has file history)
  if (restoreFiles) {
    await session.query.rewindFiles(sdkMessageId, { dryRun: false });
  }

  // 2. Resolve the message immediately before the target for the fork point
  const prevMessageId = await findPrevMessageId(sessionId, sdkMessageId);

  // 3. Fork the conversation
  const { forkSession } = await import("@anthropic-ai/claude-agent-sdk");
  let forkedSessionId: string;
  if (prevMessageId) {
    const result = await forkSession(sessionId, {
      upToMessageId: prevMessageId,
      dir: session.cwd,
      title,
    });
    forkedSessionId = result.sessionId;
  } else {
    // Rewinding to first message — create a fresh session
    const result = await createSession(session.cwd);
    forkedSessionId = result.sessionId;
  }

  // 4. Close original session's Query (keep .jsonl on disk)
  await closeSession(sessionId);

  log(
    "rewindToMessage: original=%s forked=%s restoreFiles=%s",
    sessionId,
    forkedSessionId,
    restoreFiles,
  );

  return { forkedSessionId, originalSessionId: sessionId };
}

/**
 * Fork an entire session: create a new session with all conversation history.
 * Works for both active (in-memory) and persisted-only (cold) sessions.
 */
export async function forkSession(
  ctx: ForkContext,
  sessionId: string,
  cwd: string,
  title?: string,
): Promise<{ forkedSessionId: string; originalSessionId: string }> {
  const { sessions, emitLifecycle, log } = ctx;

  const forkTitle = title ? `${title} (Fork)` : "(Fork)";

  // Find the last message ID — needed by SDK's forkSession
  const { forkSession: sdkForkSession } = await import("@anthropic-ai/claude-agent-sdk");

  const lastMessageId = await resolveForkLastMessageId(sessionId, sessions.get(sessionId));

  const result = await sdkForkSession(sessionId, {
    upToMessageId: lastMessageId,
    dir: cwd,
    title: forkTitle,
  });

  const now = new Date().toISOString();
  emitLifecycle({
    type: "created",
    session: {
      sessionId: result.sessionId,
      cwd,
      createdAt: now,
      updatedAt: now,
      title: forkTitle,
    },
  });

  log("forkSession: original=%s forked=%s", sessionId, result.sessionId);

  return { forkedSessionId: result.sessionId, originalSessionId: sessionId };
}
