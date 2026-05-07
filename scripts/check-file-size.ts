#!/usr/bin/env bun
/**
 * File-size policy guard.
 *
 * Three policy buckets, each with a hard line-count ceiling:
 *
 *   P0_critical — ACP plumbing, root router, preload bridge (max 500)
 *   P1_features — feature + plugin modules           (max 800)
 *   P2_general  — generic UI primitives              (max 1200)
 *
 * Files that already exceed their ceiling at adoption time are frozen
 * in `scripts/baseline.json`. The script then enforces:
 *
 *   - frozen file → must NOT grow past its baseline value
 *   - non-frozen file → must NOT exceed bucket max
 *
 * This lets us draw a hard line on new growth without forcing an
 * immediate refactor of every god module.
 *
 * Flags:
 *   --update-baseline   Regenerate baseline.json from current state.
 *                       Run this only when the over-threshold set
 *                       changes intentionally (e.g. after a refactor
 *                       that splits a large file).
 *   --report            Print per-bucket Top-10 listing alongside check.
 */

import { Glob } from "bun";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const desktopRoot = path.join(repoRoot, "packages/desktop");
const desktopSrc = path.join(desktopRoot, "src");
const policyPath = path.join(import.meta.dir, "policy.json");
const baselinePath = path.join(import.meta.dir, "baseline.json");

interface Bucket {
  description: string;
  paths: ReadonlyArray<string>;
  max: number;
}

interface Policy {
  P0_critical: Bucket;
  P1_features: Bucket;
  P2_general: Bucket;
  exclude: ReadonlyArray<string>;
}

type Baseline = Record<string, number>;

interface Entry {
  /** path relative to packages/desktop/, forward-slash separated */
  rel: string;
  bucket: keyof Omit<Policy, "exclude">;
  max: number;
  lines: number;
  baseline: number | undefined;
}

interface Violation {
  entry: Entry;
  reason: string;
}

async function loadPolicy(): Promise<Policy> {
  return JSON.parse(await readFile(policyPath, "utf8")) as Policy;
}

async function loadBaseline(): Promise<Baseline> {
  try {
    return JSON.parse(await readFile(baselinePath, "utf8")) as Baseline;
  } catch {
    return {};
  }
}

function matchesAny(rel: string, patterns: ReadonlyArray<string>): boolean {
  for (const pattern of patterns) {
    if (new Glob(pattern).match(rel)) return true;
  }
  return false;
}

function classify(
  rel: string,
  policy: Policy,
): { bucket: keyof Omit<Policy, "exclude">; max: number } | null {
  if (matchesAny(rel, policy.exclude)) return null;
  // P0 wins over P1 wins over P2 — order matters.
  if (matchesAny(rel, policy.P0_critical.paths)) {
    return { bucket: "P0_critical", max: policy.P0_critical.max };
  }
  if (matchesAny(rel, policy.P1_features.paths)) {
    return { bucket: "P1_features", max: policy.P1_features.max };
  }
  if (matchesAny(rel, policy.P2_general.paths)) {
    return { bucket: "P2_general", max: policy.P2_general.max };
  }
  return null;
}

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
}

async function countLines(file: string): Promise<number> {
  const content = await readFile(file, "utf8");
  let lines = 0;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) lines++;
  }
  // count last line if it lacks trailing newline
  if (content.length > 0 && content.charCodeAt(content.length - 1) !== 10) lines++;
  return lines;
}

async function collectEntries(policy: Policy, baseline: Baseline): Promise<Entry[]> {
  const files: string[] = [];
  await walk(desktopSrc, files);

  const entries: Entry[] = [];
  for (const file of files) {
    const rel = path.relative(desktopRoot, file).split(path.sep).join("/");
    const klass = classify(rel, policy);
    if (!klass) continue;
    const lines = await countLines(file);
    entries.push({
      rel,
      bucket: klass.bucket,
      max: klass.max,
      lines,
      baseline: baseline[rel],
    });
  }
  entries.sort((a, b) => b.lines - a.lines);
  return entries;
}

async function writeBaseline(over: Baseline): Promise<void> {
  const sorted = Object.fromEntries(Object.entries(over).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(baselinePath, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
}

function printReport(entries: ReadonlyArray<Entry>): void {
  const buckets: Array<keyof Omit<Policy, "exclude">> = [
    "P0_critical",
    "P1_features",
    "P2_general",
  ];
  for (const b of buckets) {
    const inBucket = entries.filter((e) => e.bucket === b);
    if (inBucket.length === 0) continue;
    const max = inBucket[0]!.max;
    console.log(`\n[${b}]  max=${max}  files=${inBucket.length}`);
    for (const e of inBucket.slice(0, 10)) {
      const flag =
        e.baseline !== undefined ? ` [baseline=${e.baseline}]` : e.lines > e.max ? " ❌" : "";
      console.log(`  ${e.lines.toString().padStart(5)}  ${e.rel}${flag}`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const updateBaseline = args.includes("--update-baseline");
  const report = args.includes("--report");

  const policy = await loadPolicy();
  const baseline = updateBaseline ? {} : await loadBaseline();
  const entries = await collectEntries(policy, baseline);

  if (updateBaseline) {
    const fresh: Baseline = {};
    for (const e of entries) {
      if (e.lines > e.max) fresh[e.rel] = e.lines;
    }
    await writeBaseline(fresh);
    const relBaselinePath = path.relative(repoRoot, baselinePath);
    console.log(
      `✅ baseline updated: ${Object.keys(fresh).length} file(s) frozen at ${relBaselinePath}`,
    );
    return;
  }

  const violations: Violation[] = [];
  for (const e of entries) {
    if (e.baseline !== undefined) {
      if (e.lines > e.baseline) {
        violations.push({
          entry: e,
          reason: `grew past frozen baseline (${e.lines} > ${e.baseline})`,
        });
      }
    } else if (e.lines > e.max) {
      violations.push({
        entry: e,
        reason: `exceeds ${e.bucket} max ${e.max} (currently ${e.lines})`,
      });
    }
  }

  if (report) printReport(entries);

  if (violations.length === 0) {
    console.log("✅ file-size check: no violations");
    return;
  }

  console.error("❌ file-size check: found violations\n");
  for (const v of violations) {
    console.error(`  ${v.entry.rel}  →  ${v.reason}`);
  }
  console.error(`\n${violations.length} violation(s)`);
  console.error("\nIf the growth is intentional (e.g. after refactor that adds new code");
  console.error("but legitimately needs more lines), regenerate the baseline:");
  console.error("  bun scripts/check-file-size.ts --update-baseline");
  process.exit(1);
}

main().catch((err) => {
  console.error("file-size check failed:", err);
  process.exit(2);
});
