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

import {
  appendFile,
  copyFile,
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { ConversationKind, SessionInfo } from "../../../../shared/features/agent/types";

import { APP_DATA_DIR } from "../../../core/app-paths";

// ---------------------------------------------------------------------------
// Session metadata — independent from SDK .jsonl files
// ---------------------------------------------------------------------------

const META_DIR = path.join(APP_DATA_DIR, "session-metas");

function getMetaPath(sessionId: string): string {
  return path.join(META_DIR, `${sessionId}.json`);
}

async function ensureMetaDir(): Promise<void> {
  await mkdir(META_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// SDK .jsonl file operations
// ---------------------------------------------------------------------------

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
 * Group metadata persisted alongside session transcripts in `.jsonl` files.
 * Mirrors the subset of SessionEntry that must survive restarts.
 */
export type SessionMeta = {
  kind?: ConversationKind;
  groupId?: string;
};

/**
 * Persist group metadata for a session.
 *
 * Metadata is stored in `~/.neovate-desktop/session-metas/{sessionId}.json`
 * — independent from the SDK-managed `.jsonl` transcript file. This
 * eliminates the race condition where `appendSessionMeta` could fire
 * before the SDK had flushed its `.jsonl` to disk.
 */
export async function appendSessionMeta(sessionId: string, meta: SessionMeta): Promise<void> {
  await ensureMetaDir();
  await writeFile(getMetaPath(sessionId), JSON.stringify(meta, null, 2));
}

/**
 * Read group metadata for a single session.
 *
 * Checks the independent metadata file first
 * (`~/.neovate-desktop/session-metas/{sessionId}.json`). If not found,
 * falls back to scanning the SDK `.jsonl` for a `session-meta` line
 * (compatibility with sessions created before the independent storage
 * migration). On a successful fallback read, the metadata is migrated
 * to the new location automatically.
 */
export async function readSessionMeta(sessionId: string): Promise<SessionMeta | undefined> {
  // 1. Try independent storage (post-migration)
  const metaPath = getMetaPath(sessionId);
  try {
    const raw = await readFile(metaPath, "utf-8");
    return JSON.parse(raw) as SessionMeta;
  } catch {
    // file not found or unreadable — fall through to legacy path
  }

  // 2. Fallback: scan SDK .jsonl (compatibility with pre-migration sessions)
  const matches = await listSessionFiles(`${sessionId}.jsonl`);
  if (matches.length === 0) return undefined;

  try {
    const content = await readFile(matches[0], "utf-8");
    const lines = content.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "session-meta") {
          const meta: SessionMeta = {
            kind: parsed.kind,
            groupId: parsed.groupId,
          };
          // Silent migration: persist to new location for future reads
          ensureMetaDir()
            .then(() => writeFile(metaPath, JSON.stringify(meta, null, 2)))
            // noop: migration is best-effort; next readSessionMeta will retry
            .catch(() => {});
          return meta;
        }
      } catch {
        // skip non-JSON or malformed lines
      }
    }
  } catch {
    // file vanished or unreadable
  }

  return undefined;
}

/**
 * Batch-read group metadata for all known sessions.
 *
 * Reads from the independent `session-metas/` directory first, then
 * falls back to scanning legacy SDK `.jsonl` files for any sessions
 * not already covered. Legacy records are silently migrated to the
 * new location on discovery.
 */
export async function readAllSessionMetas(): Promise<Map<string, SessionMeta>> {
  const metaMap = new Map<string, SessionMeta>();

  // 1. Read all metadata from independent storage
  try {
    const entries = await readdir(META_DIR, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && e.name.endsWith(".json"));
    const results = await Promise.all(
      files.map(async (file) => {
        try {
          const id = path.basename(file.name, ".json");
          const raw = await readFile(path.join(META_DIR, file.name), "utf-8");
          return [id, JSON.parse(raw) as SessionMeta] as const;
        } catch {
          return null;
        }
      }),
    );
    for (const entry of results) {
      if (entry) metaMap.set(entry[0], entry[1]);
    }
  } catch {
    // directory doesn't exist yet (no sessions created since migration)
  }

  // 2. Fallback: scan legacy .jsonl for sessions not yet migrated
  const sessionFiles = await listSessionFiles();
  const legacyResults = await Promise.all(
    sessionFiles
      .filter((file) => {
        const id = path.basename(file, ".jsonl");
        return !metaMap.has(id); // skip already-covered sessions
      })
      .map(async (file) => {
        try {
          const id = path.basename(file, ".jsonl");
          const content = await readFile(file, "utf-8");
          const lines = content.split("\n");
          for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (!line) continue;
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === "session-meta") {
                const meta: SessionMeta = {
                  kind: parsed.kind,
                  groupId: parsed.groupId,
                };
                // Silent migration
                ensureMetaDir()
                  .then(() => writeFile(getMetaPath(id), JSON.stringify(meta, null, 2)))
                  // noop: migration is best-effort
                  .catch(() => {});
                return [id, meta] as const;
              }
            } catch {
              // skip
            }
          }
          return null;
        } catch {
          return null;
        }
      }),
  );

  for (const entry of legacyResults) {
    if (entry) metaMap.set(entry[0], entry[1]);
  }

  return metaMap;
}

/**
 * Project SDK session info onto our wire-shape `SessionInfo`, picking the
 * best available title and the more accurate disk birthtime when present.
 * When `metaMap` is provided, group metadata (kind/groupId)
 * is overlaid onto the result.
 */
export function projectSessionInfo(
  sessions: SDKSessionInfo[],
  birthtimeMap: Map<string, Date>,
  metaMap?: Map<string, SessionMeta>,
): SessionInfo[] {
  return sessions.map((s) => {
    const meta = metaMap?.get(s.sessionId);
    return {
      sessionId: s.sessionId,
      title: s.customTitle ?? s.summary ?? s.firstPrompt?.slice(0, 50) ?? "New Session",
      cwd: s.cwd,
      updatedAt: new Date(s.lastModified).toISOString(),
      createdAt: (birthtimeMap.get(s.sessionId) ?? new Date(s.lastModified)).toISOString(),
      kind: meta?.kind,
      groupId: meta?.groupId,
    };
  });
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
  const [birthtimeMap, metaMap] = await Promise.all([buildBirthtimeMap(), readAllSessionMetas()]);

  const result = projectSessionInfo(sessions, birthtimeMap, metaMap);

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
 * Delete a session's `.jsonl` file(s) and metadata file from disk.
 * No-op (logged) if no `.jsonl` file is found. Errors are swallowed
 * per-file so one failure does not abort the rest — the caller is
 * responsible for any side effects (e.g. emitting a `deleted`
 * lifecycle event).
 */
export async function deleteSessionFiles(
  sessionId: string,
  log: (fmt: string, ...args: unknown[]) => void,
): Promise<void> {
  const matches = await listSessionFiles(`${sessionId}.jsonl`);
  if (matches.length === 0) {
    log("deleteSessionFiles: no file found for sessionId=%s", sessionId);
  } else {
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

  // Also clean up independent metadata file
  const metaPath = getMetaPath(sessionId);
  try {
    await unlink(metaPath);
  } catch {
    // noop: metadata file may not exist (legacy session or already cleaned)
  }
}

/**
 * Atomically back up a session's `.jsonl` transcript and metadata to
 * `~/.neovate-desktop/rewind-history/<sessionId>/<timestamp>.jsonl`,
 * write a `<timestamp>.meta.json` companion, then delete the originals.
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
  }

  const backupDir = path.join(APP_DATA_DIR, "rewind-history", sessionId);
  await mkdir(backupDir, { recursive: true });

  const now = new Date();
  const timestamp = now.toISOString().replace(/:/g, "-").replace(/\./g, "-");

  if (matches.length > 0) {
    await copyFile(matches[0], path.join(backupDir, `${timestamp}.jsonl`));
  }

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
      groupMembers: (meta as Record<string, unknown>).groupMembers,
      backedUpAt: now.toISOString(),
    },
    null,
    2,
  );
  await writeFile(path.join(backupDir, `${timestamp}.meta.json`), metaJson, "utf-8");

  // Also back up the independent metadata file if it exists
  const metaPath = getMetaPath(sessionId);
  try {
    await copyFile(metaPath, path.join(backupDir, `${timestamp}.session-meta.json`));
  } catch {
    // noop: metadata file may not exist (legacy session)
  }

  log("archiveSessionFiles: backed up sessionId=%s to %s", sessionId, backupDir);

  // Delete originals only after backup succeeds
  if (matches.length > 0) {
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

  // Clean up independent metadata
  try {
    await unlink(metaPath);
  } catch {
    // noop
  }
}
