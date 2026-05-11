/**
 * Session file-system store.
 *
 * The Claude Agent SDK persists each session's transcript as a single
 * `.jsonl` file under `~/.claude/projects/<dir>/<sessionId>.jsonl`. This
 * module owns the disk-side operations on those files: enumerating them,
 * stat'ing for birthtime, renaming via `custom-title` records, deleting,
 * and archiving for rewind history.
 *
 * Pulled out of `session-manager.ts` so the manager class stops mixing
 * orchestration with raw fs work. Behavior must remain identical to the
 * inlined versions — these are pure relocations, not redesigns.
 */

import type { SDKSessionInfo } from "@anthropic-ai/claude-agent-sdk";

import { appendFile, copyFile, mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { SessionInfo } from "../../../../shared/features/agent/types";

import { APP_DATA_DIR } from "../../../core/app-paths";

/**
 * List `.jsonl` files one level deep under `~/.claude/projects/`.
 * If `filter` is provided, returns only files whose basename matches.
 */
export async function listSessionFiles(filter?: string): Promise<string[]> {
  const baseDir = path.join(homedir(), ".claude", "projects");
  let dirs: string[];
  try {
    const entries = await readdir(baseDir, { withFileTypes: true });
    dirs = entries.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const perDir = await Promise.all(
    dirs.map(async (dir) => {
      try {
        const files = await readdir(path.join(baseDir, dir));
        const matched: string[] = [];
        for (const f of files) {
          if (filter ? f === filter : f.endsWith(".jsonl")) {
            matched.push(path.join(baseDir, dir, f));
          }
        }
        return matched;
      } catch {
        return [];
      }
    }),
  );
  return perDir.flat();
}

/**
 * Stat every session file under `~/.claude/projects/` to build a
 * `sessionId -> birthtime` map. Used to override SDK-reported timestamps,
 * which only reflect last-modified time.
 */
export async function buildBirthtimeMap(): Promise<Map<string, Date>> {
  const sessionFiles = await listSessionFiles();
  const birthtimeMap = new Map<string, Date>();
  const statResults = await Promise.all(
    sessionFiles.map(async (file) => {
      try {
        const id = path.basename(file, ".jsonl");
        const { birthtime } = await stat(file);
        return [id, birthtime] as const;
      } catch {
        return null;
      }
    }),
  );
  for (const entry of statResults) {
    if (entry) birthtimeMap.set(entry[0], entry[1]);
  }
  return birthtimeMap;
}

/**
 * Project SDK session info onto our wire-shape `SessionInfo`, picking the
 * best available title and the more accurate disk birthtime when present.
 */
export function projectSessionInfo(
  sessions: SDKSessionInfo[],
  birthtimeMap: Map<string, Date>,
): SessionInfo[] {
  return sessions.map((s) => ({
    sessionId: s.sessionId,
    title: s.customTitle ?? s.summary ?? s.firstPrompt?.slice(0, 50) ?? "New Session",
    cwd: s.cwd,
    updatedAt: new Date(s.lastModified).toISOString(),
    createdAt: (birthtimeMap.get(s.sessionId) ?? new Date(s.lastModified)).toISOString(),
  }));
}

/**
 * Enumerate all sessions (optionally filtered by cwd) and project each onto
 * our wire-shape `SessionInfo`, overlaying disk birthtime onto the SDK's
 * lastModified-based createdAt.
 *
 * Pulled out of `SessionManager.listSessions` so the manager keeps a thin
 * delegate. The dynamic SDK import is preserved here to keep the module
 * graph identical (avoiding eager top-level import at startup cost).
 */
export async function listAllSessions(
  cwd: string | undefined,
  log: (fmt: string, ...args: unknown[]) => void,
): Promise<SessionInfo[]> {
  const t0 = performance.now();
  const { listSessions: sdkListSessions } = await import("@anthropic-ai/claude-agent-sdk");
  const sessions = await sdkListSessions(cwd ? { dir: cwd } : undefined);

  // Build sessionId -> file birthtime map for accurate createdAt
  const birthtimeMap = await buildBirthtimeMap();

  const result = projectSessionInfo(sessions, birthtimeMap);

  log("listSessions: DONE in %dms count=%d", Math.round(performance.now() - t0), result.length);
  return result;
}

/**
 * Persist a custom title for a session by appending a `custom-title`
 * record to its `.jsonl` file. The SDK reads these on next listSessions
 * and prefers them over derived titles.
 *
 * Throws if the session file cannot be located on disk.
 */
export async function appendCustomTitle(sessionId: string, title: string): Promise<void> {
  const matches = await listSessionFiles(`${sessionId}.jsonl`);
  if (matches.length === 0) {
    throw new Error(`Session file not found: ${sessionId}`);
  }
  const entry = JSON.stringify({ type: "custom-title", customTitle: title, sessionId });
  await appendFile(matches[0], entry + "\n");
}

/**
 * Delete a session's `.jsonl` file(s) from disk. No-op (logged) if no
 * file is found. Errors are swallowed per-file so one failure does not
 * abort the rest — the caller is responsible for any side effects
 * (e.g. emitting a `deleted` lifecycle event).
 */
export async function deleteSessionFiles(
  sessionId: string,
  log: (fmt: string, ...args: unknown[]) => void,
): Promise<void> {
  const matches = await listSessionFiles(`${sessionId}.jsonl`);
  if (matches.length === 0) {
    log("deleteSessionFiles: no file found for sessionId=%s", sessionId);
    return;
  }
  for (const file of matches) {
    try {
      await unlink(file);
      log("deleteSessionFiles: deleted %s", file);
    } catch (error) {
      log(
        "deleteSessionFiles: failed to delete %s error=%s",
        file,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

/**
 * Atomically back up a session's `.jsonl` to
 * `~/.neovate-desktop/rewind-history/<sessionId>/<timestamp>.jsonl`,
 * write a `<timestamp>.meta.json` companion, then delete the original.
 * Delete only runs after the copy has succeeded.
 */
export async function archiveSessionFiles(
  sessionId: string,
  meta: {
    forkedSessionId: string;
    rewindMessageId: string;
    restoreFiles: boolean;
    title?: string;
    cwd?: string;
  },
  log: (fmt: string, ...args: unknown[]) => void,
): Promise<void> {
  const matches = await listSessionFiles(`${sessionId}.jsonl`);
  if (matches.length === 0) {
    log("archiveSessionFiles: no file found for sessionId=%s", sessionId);
    return;
  }

  const backupDir = path.join(APP_DATA_DIR, "rewind-history", sessionId);
  await mkdir(backupDir, { recursive: true });

  const now = new Date();
  const timestamp = now.toISOString().replace(/:/g, "-").replace(/\./g, "-");

  await copyFile(matches[0], path.join(backupDir, `${timestamp}.jsonl`));

  const metaJson = JSON.stringify(
    {
      originalSessionId: sessionId,
      forkedSessionId: meta.forkedSessionId,
      rewindMessageId: meta.rewindMessageId,
      restoreFiles: meta.restoreFiles,
      title: meta.title,
      cwd: meta.cwd,
      kind: (meta as Record<string, unknown>).kind,
      groupId: (meta as Record<string, unknown>).groupId,
      focusProjectId: (meta as Record<string, unknown>).focusProjectId,
      groupMembers: (meta as Record<string, unknown>).groupMembers,
      backedUpAt: now.toISOString(),
    },
    null,
    2,
  );
  await writeFile(path.join(backupDir, `${timestamp}.meta.json`), metaJson, "utf-8");

  log("archiveSessionFiles: backed up sessionId=%s to %s", sessionId, backupDir);

  // Delete original only after backup succeeds
  for (const file of matches) {
    try {
      await unlink(file);
      log("archiveSessionFiles: deleted %s", file);
    } catch (error) {
      log(
        "archiveSessionFiles: failed to delete %s error=%s",
        file,
        error instanceof Error ? error.message : error,
      );
    }
  }
}
