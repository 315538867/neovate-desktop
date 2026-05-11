/**
 * User-message send pipeline.
 *
 * Pulled out of `SessionManager.send` so the manager class stays focused
 * on orchestration. Behavior must remain bit-for-bit identical to the
 * inlined version — pure relocation, not a redesign.
 *
 * Steps (in order):
 *   1. Validate session is open and consume loop alive.
 *   2. Collapse UIMessage parts back to plain text via
 *      extractReadableUserText (preserves slash-command names).
 *   3. Emit "created" lifecycle on first message of the session.
 *   4. Build the SDK content payload — string for text-only, structured
 *      blocks (text + image + pdf) when media attachments exist.
 *   5. Snapshot the git working tree (`git stash create`, falling back to
 *      HEAD) into session.preTurnRef so rewind/diff has a reference point.
 *   6. Allocate a UUID, record the UI→SDK mapping for rewind, and push
 *      the SDKUserMessage onto the session input Pushable.
 */

import type { EventPublisher } from "@orpc/server";

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import type { ClaudeCodeUIEvent, ClaudeCodeUIMessage } from "../../../../shared/claude-code/types";
import type { SessionLifecycleEvent } from "../../../../shared/features/agent/types";
import type { PowerBlockerService } from "../../../core/power-blocker-service";
import type { RequestTracker } from "../request-tracker";
import type { SessionEntry } from "./types";

import { extractReadableUserText } from "../../../../shared/claude-code/extract-readable-user-text";

const execFileAsync = promisify(execFile);

/**
 * Bundle of manager-owned state that send() touches. Same shape pattern
 * as InitContext — passes Map/Set/service references so the helper
 * mutates the live manager state.
 */
export interface SendContext {
  sessions: Map<string, SessionEntry>;
  emittedCreatedSessions: Set<string>;
  emitLifecycle: (event: SessionLifecycleEvent) => void;
  requestTracker: RequestTracker;
  powerBlocker: PowerBlockerService;
  // eventPublisher is unused today but matches the InitContext shape so
  // future cross-cutting events (e.g. send-failed) can be published here.
  eventPublisher: EventPublisher<Record<string, ClaudeCodeUIEvent>>;
  /** Restart the consume loop when it has exited due to an SDK error. */
  restartConsume: (sessionId: string) => Promise<void>;
}

/**
 * Send a user message into the session's input Pushable.
 * Does NOT consume the query iterator — that is handled by consume().
 */
export async function sendUserMessage(
  ctx: SendContext,
  sessionId: string,
  message: ClaudeCodeUIMessage,
): Promise<void> {
  const { sessions, emittedCreatedSessions, emitLifecycle, requestTracker, powerBlocker } = ctx;

  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Unknown session: ${sessionId}`);
  if (session.consumeExited) {
    await ctx.restartConsume(sessionId);
  }

  // UIMessage -> SDKUserMessage: collapse text + slash-command parts back to
  // their plain-text form (e.g. `data-slash-command{name:"zcf:workflow"}` →
  // `/zcf:workflow`). Filtering by `type:"text"` here would silently drop the
  // command name, causing the SDK to receive only the trailing args and never
  // recognise the slash command on either expansion or persistence.
  const text = extractReadableUserText(message.parts);

  // Emit lifecycle "created" on first message (not on createSession, so empty sessions don't appear)
  if (!emittedCreatedSessions.has(sessionId)) {
    emittedCreatedSessions.add(sessionId);
    const now = new Date().toISOString();
    emitLifecycle({
      type: "created",
      session: {
        sessionId,
        cwd: session.cwd,
        createdAt: now,
        updatedAt: now,
        title: text.slice(0, 50),
      },
    });
  }

  const imageBlocks = message.parts
    .filter(
      (p): p is { type: "file"; mediaType: string; url: string } =>
        p.type === "file" &&
        typeof (p as any).mediaType === "string" &&
        (p as any).mediaType.startsWith("image/"),
    )
    .map((p) => {
      const base64 = p.url.startsWith("data:") ? p.url.split(",")[1] : p.url;
      return {
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: p.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: base64,
        },
      };
    });

  const pdfBlocks = message.parts
    .filter(
      (p): p is { type: "file"; mediaType: string; url: string } =>
        p.type === "file" &&
        typeof (p as any).mediaType === "string" &&
        (p as any).mediaType === "application/pdf",
    )
    .map((p) => {
      const base64 = p.url.startsWith("data:") ? p.url.split(",")[1] : p.url;
      return {
        type: "document" as const,
        source: {
          type: "base64" as const,
          media_type: "application/pdf" as const,
          data: base64,
        },
      };
    });

  const mediaBlocks = [...imageBlocks, ...pdfBlocks];
  const content =
    mediaBlocks.length > 0
      ? [...(text ? [{ type: "text" as const, text }] : []), ...mediaBlocks]
      : text;

  // Pre-turn snapshot: capture working tree state before Claude modifies files
  let preTurnRef: string | undefined;
  try {
    const { stdout } = await execFileAsync("git", ["stash", "create"], { cwd: session.cwd });
    preTurnRef = stdout.trim() || undefined;
  } catch {
    // not a git repo or git not available — skip
  }
  // Fall back to HEAD if working tree was clean (git stash create returns empty)
  if (!preTurnRef) {
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: session.cwd });
      preTurnRef = stdout.trim() || undefined;
    } catch {
      // ignore
    }
  }
  session.preTurnRef = preTurnRef;

  const userMessageId = randomUUID();
  session.lastUserMessageId = userMessageId;
  // Track UI message ID → SDK UUID mapping for rewind
  if (message.id) {
    session.uiToSdkMessageIds.set(message.id, userMessageId);
  }

  requestTracker.startTurn(sessionId);
  powerBlocker.onTurnStart(sessionId);
  session.input.push({
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
    session_id: sessionId,
    uuid: userMessageId,
  });
}
