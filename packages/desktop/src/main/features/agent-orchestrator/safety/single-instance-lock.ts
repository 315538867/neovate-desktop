/**
 * Agent Orchestrator — Single-instance run lock.
 *
 * A run that owns a sandbox/worktree must hold an exclusive filesystem
 * lock; if a second Electron instance recovers the same run after a
 * crash, both sides could race to mutate the worktree. This lock is a
 * lightweight `lockfile` in `~/.neovate-desktop/orchestrator/locks/`.
 *
 * The acquire path uses `O_EXCL | O_CREAT` to fail-fast if a lock
 * already exists. Each lock file embeds the holder's pid + monotonic
 * ts so a stale lock from a previous crash can be detected and
 * stolen.
 *
 * No timer-based renewal — we treat locks as advisory and rely on
 * graceful release in `before-quit`. Stale locks are detected on
 * next acquire (pid no longer exists / file older than `staleMs`).
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export type SingleInstanceLockDeps = {
  /** Directory that holds lock files (created lazily). */
  rootDir: string;
  /** Override for deterministic tests. */
  clock?: () => number;
  /** Override for deterministic tests. Defaults to `process.pid`. */
  pid?: number;
  /** Lock files older than this are considered stale. Default 24h. */
  staleMs?: number;
  /** Process-existence probe; default `process.kill(pid, 0)`. */
  isPidAlive?: (pid: number) => boolean;
};

export type LockHandle = {
  runId: string;
  release: () => void;
};

const DEFAULT_STALE_MS = 24 * 60 * 60 * 1000;

function defaultIsPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we are not allowed to signal it.
    return (err as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

export class SingleInstanceLock {
  private readonly rootDir: string;
  private readonly clock: () => number;
  private readonly pid: number;
  private readonly staleMs: number;
  private readonly isPidAlive: (pid: number) => boolean;

  constructor(deps: SingleInstanceLockDeps) {
    this.rootDir = deps.rootDir;
    this.clock = deps.clock ?? Date.now;
    this.pid = deps.pid ?? process.pid;
    this.staleMs = deps.staleMs ?? DEFAULT_STALE_MS;
    this.isPidAlive = deps.isPidAlive ?? defaultIsPidAlive;
  }

  acquire(runId: string): LockHandle {
    if (!runId) throw new Error("runId required");
    mkdirSync(this.rootDir, { recursive: true });
    const file = this.lockPath(runId);
    if (existsSync(file)) {
      const stale = this.readStale(file);
      if (!stale) {
        throw new Error(`Run "${runId}" is already locked by another instance`);
      }
      // Stale — sweep and continue.
      try {
        unlinkSync(file);
      } catch {
        // best-effort
      }
    }
    let fd: number;
    try {
      // wx = O_WRONLY | O_CREAT | O_EXCL
      fd = openSync(file, "wx");
    } catch (err) {
      throw new Error(
        `Failed to acquire lock for run "${runId}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      const payload = JSON.stringify({ pid: this.pid, ts: this.clock() });
      writeFileSync(fd, payload, "utf8");
    } finally {
      try {
        closeSync(fd);
      } catch {
        // best-effort
      }
    }
    return {
      runId,
      release: () => this.release(runId),
    };
  }

  release(runId: string): void {
    const file = this.lockPath(runId);
    try {
      unlinkSync(file);
    } catch {
      // best-effort
    }
  }

  /** Public for tests. */
  lockPath(runId: string): string {
    const safe = runId.replace(/[^a-z0-9_\-.]/gi, "_");
    return path.join(this.rootDir, `${safe}.lock`);
  }

  private readStale(file: string): boolean {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      return true;
    }
    let pid: number | undefined;
    let ts: number | undefined;
    try {
      const parsed = JSON.parse(raw) as { pid?: unknown; ts?: unknown };
      if (typeof parsed.pid === "number") pid = parsed.pid;
      if (typeof parsed.ts === "number") ts = parsed.ts;
    } catch {
      return true;
    }
    if (pid === undefined || ts === undefined) return true;
    if (this.clock() - ts >= this.staleMs) return true;
    return !this.isPidAlive(pid);
  }
}
