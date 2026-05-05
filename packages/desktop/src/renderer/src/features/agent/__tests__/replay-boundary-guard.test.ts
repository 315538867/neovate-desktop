/**
 * Replay-boundary guard.
 *
 * Wave 0 framework. Each fixture is a JSONL stream of `UIMessageChunk`
 * captured from real ACP traffic. We replay each fixture through both
 * the "baseline" pipeline (current `processUIMessageStream`) and the
 * "optimized" pipeline (currently identical — diverges in Wave 2). The
 * resulting `UIMessage` objects are normalized and SHA256-hashed; the
 * test asserts the two hashes match.
 *
 * Today the test always passes because both paths share an
 * implementation. The point is to lock down semantics _before_ we
 * refactor: any future change to the streaming pipeline that alters
 * observable message shape will fail this guard, forcing an explicit
 * fixture update.
 *
 * Adding a fixture:
 *   1. Capture the chunk stream (jsonl, one chunk per line).
 *   2. Drop it under `__fixtures__/replay/NNN-name.jsonl`.
 *   3. Append the basename to FIXTURES below.
 */

import type { UIMessage, UIMessageChunk } from "ai";

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createStreamingUIMessageState,
  processUIMessageStream,
} from "../process-ui-message-stream";

const FIXTURE_DIR = path.join(import.meta.dirname, "..", "__fixtures__", "replay");

const FIXTURES = [
  "001-simple-text",
  "002-multi-tool",
  "003-rewind-fork",
  "004-slash-command",
  "005-interrupt",
  "006-compact-boundary",
] as const;

function loadFixture(name: string): UIMessageChunk[] {
  const raw = readFileSync(path.join(FIXTURE_DIR, `${name}.jsonl`), "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as UIMessageChunk);
}

async function replay(chunks: ReadonlyArray<UIMessageChunk>): Promise<UIMessage> {
  const startChunk = chunks.find((c) => c.type === "start");
  const messageId =
    startChunk && "messageId" in startChunk && typeof startChunk.messageId === "string"
      ? startChunk.messageId
      : "fixture-msg";

  const state = createStreamingUIMessageState({ messageId, lastMessage: undefined });

  for (const chunk of chunks) {
    await processUIMessageStream({
      chunk,
      state,
      write: () => {},
      onError: (e) => {
        throw e;
      },
    });
  }
  return state.message;
}

// Wave 0: both paths share the same impl. Wave 2 will swap `replayOptimized`
// to point at the refactored pipeline; the hash comparison then becomes
// load-bearing.
const replayBaseline = replay;
const replayOptimized = replay;

const VOLATILE_KEYS = new Set(["timestamp", "createdAt", "updatedAt"]);

/**
 * Recursively strip volatile / non-deterministic fields from a replayed
 * message before hashing. `undefined` values and volatile keys are
 * dropped entirely so they don't influence the hash.
 */
function normalize(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(normalize);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (VOLATILE_KEYS.has(k)) continue;
    if (v === undefined) continue;
    out[k] = normalize(v);
  }
  return out;
}

/**
 * Stable JSON serialization with deterministic key order so the hash
 * doesn't depend on object-key insertion order.
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function semanticsHash(message: UIMessage): string {
  return createHash("sha256")
    .update(stableStringify(normalize(message)))
    .digest("hex");
}

describe("replay-boundary-guard", () => {
  for (const name of FIXTURES) {
    it(`${name}: baseline and optimized produce identical semantics`, async () => {
      const chunks = loadFixture(name);
      expect(chunks.length).toBeGreaterThan(0);

      const baseline = await replayBaseline(chunks);
      const optimized = await replayOptimized(chunks);

      expect(semanticsHash(baseline)).toEqual(semanticsHash(optimized));
      // Sanity: replay produced a non-trivial message structure.
      expect(baseline.parts.length).toBeGreaterThan(0);
    });
  }
});
