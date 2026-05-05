/**
 * Rewind & fork helpers.
 *
 * Pure-ish functions that read or compute over an in-memory `SessionEntry`
 * without mutating SessionManager-level state. The orchestration methods
 * `rewindToMessage` and `forkSession` stay in the manager because they
 * coordinate cross-session work (closeSession / emitLifecycle), but
 * everything they reach through to do its actual job lives here.
 */

import type { Query } from "@anthropic-ai/claude-agent-sdk";

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { RewindFilesResult } from "../../../../shared/features/agent/types";
import type { SessionEntry } from "./types";

const execFileAsync = promisify(execFile);

/**
 * Map a UI-side message ID back to the SDK UUID used by `query.rewindFiles`
 * and the SDK-internal message graph. Falls back to the input when the UI
 * id is already an SDK uuid (e.g. on first turn).
 */
export function resolveSdkMessageId(
  session: Pick<SessionEntry, "uiToSdkMessageIds">,
  uiMessageId: string,
): string {
  return session.uiToSdkMessageIds.get(uiMessageId) ?? uiMessageId;
}

/** Files changed in the last agent turn, or a structured no-op result. */
export async function lastTurnFiles(
  session: Pick<SessionEntry, "query" | "lastUserMessageId">,
): Promise<RewindFilesResult> {
  if (!session.lastUserMessageId) {
    return { canRewind: false, error: "No turns completed yet" };
  }
  try {
    return await session.query.rewindFiles(session.lastUserMessageId, { dryRun: true });
  } catch (error) {
    return {
      canRewind: false,
      error: error instanceof Error ? error.message : "Failed to get last turn files",
    };
  }
}

/**
 * Show the diff for one file changed in the last agent turn. `oldContent`
 * is read from the pre-turn git snapshot; `newContent` from the current
 * working tree. Either side may be empty if the file didn't exist.
 */
export async function lastTurnDiff(
  session: Pick<SessionEntry, "cwd" | "preTurnRef">,
  file: string,
): Promise<{
  success: boolean;
  data?: { oldContent: string; newContent: string };
  error?: string;
}> {
  const ref = session.preTurnRef;
  if (!ref) {
    return { success: false, error: "No pre-turn snapshot available" };
  }

  try {
    // Old content: from the pre-turn snapshot
    let oldContent = "";
    try {
      const { stdout } = await execFileAsync("git", ["show", `${ref}:${file}`], {
        cwd: session.cwd,
        maxBuffer: 10 * 1024 * 1024,
      });
      oldContent = stdout;
    } catch {
      // file didn't exist before this turn
    }

    // New content: current file on disk
    let newContent = "";
    try {
      const filePath = path.resolve(session.cwd, file);
      newContent = await readFile(filePath, "utf8");
    } catch {
      // file was deleted during this turn
    }

    return { success: true, data: { oldContent, newContent } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to get diff",
    };
  }
}

/** Dry-run: list files that would change if we rewound to `messageId`. */
export async function rewindFilesDryRun(
  session: Pick<SessionEntry, "query" | "uiToSdkMessageIds">,
  messageId: string,
): Promise<RewindFilesResult> {
  const sdkMessageId = resolveSdkMessageId(session, messageId);
  try {
    return await session.query.rewindFiles(sdkMessageId, { dryRun: true });
  } catch (error) {
    return {
      canRewind: false,
      error: error instanceof Error ? error.message : "Failed to get rewind files",
    };
  }
}

/**
 * Find the SDK UUID of the message immediately before `targetMessageId` in
 * the session transcript. Returns undefined if the target is the first
 * message (or not in the transcript).
 */
export async function findPrevMessageId(
  sessionId: string,
  targetMessageId: string,
): Promise<string | undefined> {
  const { getSessionMessages } = await import("@anthropic-ai/claude-agent-sdk");
  const messages = await getSessionMessages(sessionId);
  let prevUuid: string | undefined;
  for (const msg of messages) {
    if (msg.uuid === targetMessageId) return prevUuid;
    prevUuid = msg.uuid;
  }
  return undefined;
}

/**
 * Resolve the last message ID for a fork operation. Active sessions read
 * from the in-memory `uiToSdkMessageIds` map; cold (persisted-only)
 * sessions fall back to the SDK's transcript reader.
 *
 * Throws when the session has no messages — an empty session can't be
 * forked because the SDK needs an `upToMessageId`.
 */
export async function resolveForkLastMessageId(
  sessionId: string,
  activeSession: Pick<SessionEntry, "uiToSdkMessageIds"> | undefined,
): Promise<string> {
  let lastMessageId: string | undefined;

  if (activeSession) {
    const ids = Array.from(activeSession.uiToSdkMessageIds.values());
    lastMessageId = ids[ids.length - 1];
  }

  if (!lastMessageId) {
    const { getSessionMessages } = await import("@anthropic-ai/claude-agent-sdk");
    const messages = await getSessionMessages(sessionId);
    if (messages.length === 0) {
      throw new Error("Cannot fork a session with no messages");
    }
    lastMessageId = messages[messages.length - 1].uuid;
  }

  return lastMessageId;
}

/** Re-export Query so callers don't need to import @anthropic-ai/claude-agent-sdk directly. */
export type { Query };
