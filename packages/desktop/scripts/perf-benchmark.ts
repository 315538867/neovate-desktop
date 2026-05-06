/**
 * Perf benchmark — chat-state stable/streaming split.
 *
 * Wave 2 Step 6 (Plan D). Stresses the chat-state hot paths exercised by
 * `chat.ts#flushStreaming` and validates the load-bearing invariant of
 * Plan D: while the streaming slot is being written, the `stableMessages`
 * array reference MUST stay identical so memoized list components can
 * skip reconciles.
 *
 * Usage:
 *   bun run perf            # writes baseline (or refreshes it).
 *   bun run perf -- --check # compare against baseline; exit 1 on >20%
 *                           # avg-time regression. Intended for CI.
 *
 * Baseline is committed at `packages/desktop/perf-baseline.json` so a
 * regression in the streaming pipeline shows up in PR diffs.
 *
 * The benchmark intentionally avoids React/jsdom — Plan D's guarantee is
 * about data-layer references, not paint behavior. Subscribers cost is
 * out of scope here; that's covered by replay-fixture semantic guards.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import type { ClaudeCodeUIMessage } from "../src/shared/claude-code/types";

import { ClaudeCodeChatState } from "../src/renderer/src/features/agent/chat-state";

interface ScenarioResult {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  /** Plan D invariant: stableMessages reference is preserved during streaming. */
  stableMessagesRefStable: boolean;
}

interface BenchmarkOutput {
  timestamp: string;
  node: string;
  results: ScenarioResult[];
}

const REGRESSION_THRESHOLD = 0.2; // 20%

function makeMessage(id: string, role: "user" | "assistant", text: string): ClaudeCodeUIMessage {
  return {
    id,
    role,
    parts: [{ type: "text", text }],
  } as ClaudeCodeUIMessage;
}

/**
 * Streaming scenario: pre-populate `priorStable` completed turns, then
 * write the streaming slot `streamingFrames` times before committing.
 * Tracks whether `stableMessages` reference changed during streaming.
 */
function scenarioStreaming(priorStable: number, streamingFrames: number): ScenarioResult {
  const state = new ClaudeCodeChatState([]);

  for (let i = 0; i < priorStable; i++) {
    state.pushMessage(makeMessage(`prior-${i}`, i % 2 === 0 ? "user" : "assistant", `prior ${i}`));
  }

  const baseStableRef = state.store.getState().stableMessages;
  let lastStableRef = baseStableRef;
  let stableRefStable = true;

  const streamingId = "stream-1";

  const t0 = performance.now();
  for (let i = 0; i < streamingFrames; i++) {
    state.setStreamingMessage(makeMessage(streamingId, "assistant", `streaming ${i}`));
    const cur = state.store.getState().stableMessages;
    if (cur !== lastStableRef) {
      stableRefStable = false;
      lastStableRef = cur;
    }
  }
  state.commitStreamingMessage();
  const totalMs = performance.now() - t0;

  return {
    name: `streaming-${priorStable}prior-${streamingFrames}frames`,
    iterations: streamingFrames,
    totalMs,
    avgMs: totalMs / streamingFrames,
    stableMessagesRefStable: stableRefStable,
  };
}

/**
 * Push scenario: append `count` completed messages back-to-back. Stresses
 * the snapshot+concat path that runs once per user turn / system event.
 */
function scenarioPush(count: number): ScenarioResult {
  const state = new ClaudeCodeChatState([]);

  const t0 = performance.now();
  for (let i = 0; i < count; i++) {
    state.pushMessage(makeMessage(`m-${i}`, i % 2 === 0 ? "user" : "assistant", `msg ${i}`));
  }
  const totalMs = performance.now() - t0;

  return {
    name: `push-${count}`,
    iterations: count,
    totalMs,
    avgMs: totalMs / count,
    stableMessagesRefStable: true, // N/A — push always mutates stable
  };
}

/**
 * Messages-getter scenario: derived `messages` array is rebuilt per slot
 * change. Cache hit when neither slot changes — verifies the cache is
 * effective.
 */
function scenarioMessagesGetter(priorStable: number, reads: number): ScenarioResult {
  const state = new ClaudeCodeChatState([]);
  for (let i = 0; i < priorStable; i++) {
    state.pushMessage(makeMessage(`m-${i}`, "assistant", `msg ${i}`));
  }
  state.setStreamingMessage(makeMessage("stream-1", "assistant", "streaming"));

  // Prime the cache before the timed loop so the first iteration also
  // exercises the cache-hit path (the very first read populates the
  // cache; without priming, cacheHits could undercount by one).
  void state.messages;

  const t0 = performance.now();
  let prev = state.messages;
  let cacheHits = 1;
  for (let i = 0; i < reads; i++) {
    const cur = state.messages;
    if (cur === prev) cacheHits++;
    prev = cur;
  }
  const totalMs = performance.now() - t0;

  return {
    name: `messages-getter-${priorStable}prior-${reads}reads`,
    iterations: reads,
    totalMs,
    avgMs: totalMs / reads,
    // reads + 1 because we counted the seed read; every read after
    // priming must hit the cache for the invariant to hold.
    stableMessagesRefStable: cacheHits === reads + 1,
  };
}

/**
 * Run a scenario `runs` times and keep the minimum totalMs / avgMs. Min
 * is the standard reduction for micro-benchmarks: it filters GC pauses
 * and other noise that only inflate measurements. The scenario name and
 * the boolean invariant remain identical across runs.
 */
function bestOfN<R extends ScenarioResult>(runs: number, fn: () => R): R {
  let best = fn();
  for (let i = 1; i < runs; i++) {
    const cur = fn();
    if (cur.totalMs < best.totalMs) best = cur;
    // Invariant must hold on every run, not just the fastest.
    if (!cur.stableMessagesRefStable) {
      best = { ...best, stableMessagesRefStable: false };
    }
  }
  return best;
}

const RUNS = 5;

function runAll(): ScenarioResult[] {
  return [
    // Streaming hot path — what flushStreaming exercises every rAF.
    bestOfN(RUNS, () => scenarioStreaming(0, 1000)),
    bestOfN(RUNS, () => scenarioStreaming(50, 1000)),
    bestOfN(RUNS, () => scenarioStreaming(200, 1000)),
    // Push path — completes-message bursts (replay, system events).
    bestOfN(RUNS, () => scenarioPush(500)),
    // Derived getter — cache effectiveness.
    bestOfN(RUNS, () => scenarioMessagesGetter(50, 10_000)),
  ];
}

function compareToBaseline(current: ScenarioResult[], baseline: BenchmarkOutput): number {
  const failures: string[] = [];
  for (const cur of current) {
    const base = baseline.results.find((r) => r.name === cur.name);
    if (!base) {
      console.warn(`[perf] new scenario "${cur.name}" — no baseline to compare`);
      continue;
    }
    if (cur.stableMessagesRefStable !== base.stableMessagesRefStable) {
      failures.push(
        `${cur.name}: stableMessagesRefStable invariant flipped ` +
          `${base.stableMessagesRefStable} → ${cur.stableMessagesRefStable}`,
      );
      continue;
    }
    // Skip the regression check on near-zero baselines — measurement noise
    // dominates and the percentage explodes meaninglessly.
    if (base.avgMs < 0.001) continue;
    const regression = (cur.avgMs - base.avgMs) / base.avgMs;
    const pct = (regression * 100).toFixed(1);
    if (regression > REGRESSION_THRESHOLD) {
      failures.push(
        `${cur.name}: avg ${base.avgMs.toFixed(4)}ms → ${cur.avgMs.toFixed(4)}ms (+${pct}%)`,
      );
    } else {
      console.log(
        `  ${cur.name}: ${base.avgMs.toFixed(4)}ms → ${cur.avgMs.toFixed(4)}ms ` +
          `(${regression >= 0 ? "+" : ""}${pct}%)`,
      );
    }
  }
  if (failures.length > 0) {
    console.error(`\n[perf] ${failures.length} regression(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    return 1;
  }
  console.log("\n[perf] no regressions");
  return 0;
}

function main(): number {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const outPath = path.join(dirname, "..", "perf-baseline.json");
  const checkMode = process.argv.includes("--check");

  const results = runAll();
  const output: BenchmarkOutput = {
    timestamp: new Date().toISOString(),
    node: process.version,
    results,
  };

  if (checkMode) {
    if (!existsSync(outPath)) {
      console.error(`[perf] --check: baseline missing at ${outPath}`);
      console.error(`[perf] run \`bun run perf\` first to capture one`);
      return 2;
    }
    const baseline = JSON.parse(readFileSync(outPath, "utf8")) as BenchmarkOutput;
    return compareToBaseline(results, baseline);
  }

  writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`[perf] wrote ${path.relative(process.cwd(), outPath)}`);
  console.table(
    results.map((r) => ({
      scenario: r.name,
      iters: r.iterations,
      total_ms: r.totalMs.toFixed(2),
      avg_ms: r.avgMs.toFixed(4),
      stable_ref_stable: r.stableMessagesRefStable,
    })),
  );
  return 0;
}

process.exit(main());
