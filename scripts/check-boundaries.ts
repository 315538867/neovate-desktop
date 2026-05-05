#!/usr/bin/env bun
/**
 * Process-boundary guard.
 *
 * neovate-desktop has three TS roots that talk to each other only over
 * well-defined channels:
 *
 *   src/main/      — Node.js / Electron main process
 *   src/preload/   — preload bridge
 *   src/renderer/  — DOM-only renderer (sandboxed-ish)
 *   src/shared/    — code intentionally shared across boundaries
 *
 * `electron-vite` enforces the build-time split, but plain typecheck
 * does not catch all boundary violations: a renderer file can still
 * import a `src/main/...` type and tsgo will happily resolve it. That
 * leaks main-process internals into the renderer bundle and turns
 * "shared" into a fiction.
 *
 * This script walks every TS/TSX file under each boundary and rejects:
 *
 *   • renderer importing electron, electron-* or src/main/*
 *   • main importing src/renderer/*
 *   • renderer importing node: core modules (renderer is DOM-only —
 *     anything node-y must come from preload / main via oRPC)
 *
 * Cross-boundary code MUST live under `src/shared/`.
 *
 * Designed to be cheap (regex over import lines, not a full AST). False
 * positives are easy to silence with eslint-style allowlists if they
 * ever appear; false negatives are the failure mode we care about.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const desktopSrc = path.join(repoRoot, "packages/desktop/src");

interface Boundary {
  /** Subdir under desktop/src/ this boundary owns. */
  root: string;
  /** Human label for error messages. */
  label: string;
  /** Forbidden bare-import package names / prefixes. */
  forbiddenPackages: ReadonlyArray<string | RegExp>;
  /** Forbidden resolved-path prefixes (relative to desktop/src). */
  forbiddenPathPrefixes: ReadonlyArray<string>;
  /** Per-file overrides keyed by exact relative path under desktop/src. */
  allowlist?: Record<string, ReadonlyArray<string>>;
}

const BOUNDARIES: ReadonlyArray<Boundary> = [
  {
    root: "renderer",
    label: "renderer",
    forbiddenPackages: [
      "electron",
      /^electron(\/|-).+/,
      /^node:.+/,
      "fs",
      "path",
      "os",
      "child_process",
      "crypto",
    ],
    forbiddenPathPrefixes: ["main/", "preload/"],
  },
  {
    root: "main",
    label: "main",
    forbiddenPackages: [],
    forbiddenPathPrefixes: ["renderer/"],
  },
];

const IMPORT_RE =
  /(?:^|\s)(?:import\s+(?:[\s\S]*?)\s+from\s+|import\s+|export\s+(?:[\s\S]*?)\s+from\s+|require\s*\(|import\s*\()\s*["']([^"']+)["']/g;

interface Violation {
  file: string;
  line: number;
  spec: string;
  reason: string;
}

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(p, out);
    } else if (/\.(ts|tsx|mts|cts)$/.test(e.name)) {
      out.push(p);
    }
  }
}

function lineForOffset(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function classify(spec: string): "package" | "relative" | "absolute" {
  if (spec.startsWith(".")) return "relative";
  if (spec.startsWith("/")) return "absolute";
  return "package";
}

function packageMatches(spec: string, patterns: ReadonlyArray<string | RegExp>): boolean {
  for (const p of patterns) {
    if (typeof p === "string") {
      if (spec === p) return true;
    } else if (p.test(spec)) {
      return true;
    }
  }
  return false;
}

function resolveRelative(fromFile: string, spec: string): string {
  const dir = path.dirname(fromFile);
  return path.resolve(dir, spec);
}

function relToSrc(absPath: string): string | null {
  const rel = path.relative(desktopSrc, absPath);
  if (rel.startsWith("..")) return null;
  return rel.split(path.sep).join("/");
}

async function checkFile(file: string, boundary: Boundary): Promise<Violation[]> {
  const text = await readFile(file, "utf8");
  const violations: Violation[] = [];
  const fileRel = relToSrc(file) ?? file;
  const allowed = boundary.allowlist?.[fileRel] ?? [];

  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[1]!;
    if (allowed.includes(spec)) continue;
    const offset = m.index ?? 0;
    const kind = classify(spec);

    if (kind === "package") {
      if (packageMatches(spec, boundary.forbiddenPackages)) {
        violations.push({
          file: fileRel,
          line: lineForOffset(text, offset),
          spec,
          reason: `package "${spec}" is forbidden in ${boundary.label}`,
        });
      }
      continue;
    }

    if (kind === "relative") {
      const resolved = resolveRelative(file, spec);
      const rel = relToSrc(resolved);
      if (!rel) continue;
      const slash = rel.endsWith("/") ? rel : `${rel}/`;
      for (const prefix of boundary.forbiddenPathPrefixes) {
        if (slash.startsWith(prefix)) {
          violations.push({
            file: fileRel,
            line: lineForOffset(text, offset),
            spec,
            reason: `${boundary.label} must not import from ${prefix} (resolves to ${rel})`,
          });
          break;
        }
      }
    }
  }

  return violations;
}

async function main(): Promise<void> {
  const allViolations: Violation[] = [];

  for (const boundary of BOUNDARIES) {
    const root = path.join(desktopSrc, boundary.root);
    const files: string[] = [];
    await walk(root, files);
    for (const f of files) {
      const vs = await checkFile(f, boundary);
      allViolations.push(...vs);
    }
  }

  if (allViolations.length === 0) {
    console.log("✅ boundary check: no violations");
    return;
  }

  console.error("❌ boundary check: found violations\n");
  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line}  →  ${v.spec}`);
    console.error(`    ${v.reason}`);
  }
  console.error(`\n${allViolations.length} violation(s)`);
  process.exit(1);
}

main().catch((err) => {
  console.error("boundary check failed:", err);
  process.exit(2);
});
