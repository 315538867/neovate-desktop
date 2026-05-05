/**
 * Session close.
 *
 * Pulled out of `SessionManager.closeSession` so the manager class
 * stays focused on orchestration. Behavior is bit-for-bit identical to
 * the inlined version — pure relocation, not a redesign.
 *
 * Steps:
 *   1. Idempotent: no-op if already closing or unknown sessionId.
 *   2. Mark closing → close SDK query (swallow errors).
 *   3. Settle every pending permission request with deny + emit
 *      request_settled events so the UI can clear its prompts.
 *   4. Delete in-memory entries (sessions, emittedCreatedSessions,
 *      closingSessions) and tear down per-session services.
 */

import type { EventPublisher } from "@orpc/server";

import type { ClaudeCodeUIEvent } from "../../../../shared/claude-code/types";
import type { PowerBlockerService } from "../../../core/power-blocker-service";
import type { RequestTracker } from "../request-tracker";
import type { SessionEntry } from "./types";

/** Bundle of manager-owned state that closeSession touches. */
export interface CloseContext {
  sessions: Map<string, SessionEntry>;
  closingSessions: Set<string>;
  emittedCreatedSessions: Set<string>;
  requestTracker: RequestTracker;
  powerBlocker: PowerBlockerService;
  eventPublisher: EventPublisher<Record<string, ClaudeCodeUIEvent>>;
  log: (fmt: string, ...args: unknown[]) => void;
}

export async function closeSession(ctx: CloseContext, sessionId: string): Promise<void> {
  const {
    sessions,
    closingSessions,
    emittedCreatedSessions,
    requestTracker,
    powerBlocker,
    eventPublisher,
    log,
  } = ctx;
  const t0 = performance.now();
  const el = (step: string) =>
    log(
      "closeSession TIMING %s sessionId=%s %dms",
      step,
      sessionId,
      Math.round(performance.now() - t0),
    );

  if (closingSessions.has(sessionId)) {
    log("closeSession: no-op, already closing sessionId=%s", sessionId);
    return;
  }
  const session = sessions.get(sessionId);
  if (!session) {
    log("closeSession: no-op, unknown sessionId=%s", sessionId);
    return;
  }
  closingSessions.add(sessionId);
  try {
    session.query.close();
  } catch (err) {
    log("closeSession: query.close error sessionId=%s err=%o", sessionId, err);
  }
  el("query.close");
  for (const [requestId, pending] of session.pendingRequests) {
    pending.resolve({ behavior: "deny", message: "Session closed" });
    eventPublisher.publish(sessionId, { kind: "request_settled", requestId });
  }
  el("pendingRequests.settled");
  sessions.delete(sessionId);
  emittedCreatedSessions.delete(sessionId);
  closingSessions.delete(sessionId);
  requestTracker.clearSession(sessionId);
  powerBlocker.onSessionClosed(sessionId);
  el("cleanup.done");
  log("closeSession: closed sessionId=%s remainingSessions=%d", sessionId, sessions.size);
}
