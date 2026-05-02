/**
 * Read compact-boundary metadata directly from a session's `.jsonl` transcript.
 *
 * Why this exists: SDK `getSessionMessages({ includeSystemMessages: true })`
 * does NOT include `compact_boundary` system entries (verified empirically on
 * SDK v0.2.108). To recover the metadata (trigger, preTokens, postTokens,
 * durationMs) we read the raw file ourselves.
 *
 * Returned in document order so callers can pair the Nth boundary with the
 * Nth synthetic compact-summary user message they encounter while transforming.
 */

import debug from "debug";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const log = debug("neovate:compact-meta");

export type CompactMeta = {
  trigger: "manual" | "auto";
  preTokens: number;
  postTokens?: number;
  durationMs?: number;
};

async function findSessionFile(sessionId: string): Promise<string | null> {
  const baseDir = path.join(homedir(), ".claude", "projects");
  const fileName = `${sessionId}.jsonl`;
  let dirs: string[];
  try {
    const entries = await readdir(baseDir, { withFileTypes: true });
    dirs = entries.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return null;
  }
  const hits = await Promise.all(
    dirs.map(async (dir) => {
      try {
        const files = await readdir(path.join(baseDir, dir));
        return files.includes(fileName) ? path.join(baseDir, dir, fileName) : null;
      } catch {
        return null;
      }
    }),
  );
  return hits.find((p) => p != null) ?? null;
}

/**
 * Parse a `compact_metadata` / `compactMetadata` object into the canonical
 * `CompactMeta` shape, tolerating both snake_case and camelCase. Exported so
 * callers with an inline boundary message (rare/forward-compat) can reuse it.
 */
export function parseCompactMeta(raw: unknown): CompactMeta | null {
  if (raw == null || typeof raw !== "object") return null;
  const cm = raw as Record<string, unknown>;
  const trigger = (cm.trigger === "manual" ? "manual" : "auto") as CompactMeta["trigger"];
  const preTokensRaw = cm.pre_tokens ?? cm.preTokens;
  const postTokensRaw = cm.post_tokens ?? cm.postTokens;
  const durationRaw = cm.duration_ms ?? cm.durationMs;
  const preTokens = Number(preTokensRaw ?? 0);
  return {
    trigger,
    preTokens: Number.isFinite(preTokens) ? preTokens : 0,
    ...(postTokensRaw != null ? { postTokens: Number(postTokensRaw) } : {}),
    ...(durationRaw != null ? { durationMs: Number(durationRaw) } : {}),
  };
}

/**
 * Read all `compact_boundary` metadata entries from `<sessionId>.jsonl`,
 * in the order they appear. Returns `[]` on any IO/parse error so callers
 * can degrade gracefully.
 */
export async function readCompactMetaFromJsonl(sessionId: string): Promise<CompactMeta[]> {
  const file = await findSessionFile(sessionId);
  if (file == null) {
    log("session file not found sessionId=%s", sessionId);
    return [];
  }
  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch (err) {
    log("readFile failed sessionId=%s err=%O", sessionId, err);
    return [];
  }
  const result: CompactMeta[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    if (line.length === 0) continue;
    if (!line.includes("compact_boundary")) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (obj.type !== "system" || obj.subtype !== "compact_boundary") continue;
    const meta = parseCompactMeta(obj.compact_metadata ?? obj.compactMetadata);
    if (meta != null) result.push(meta);
  }
  log("sessionId=%s metas=%d", sessionId, result.length);
  return result;
}
