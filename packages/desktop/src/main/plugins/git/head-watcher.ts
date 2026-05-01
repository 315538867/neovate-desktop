import type { FSWatcher } from "chokidar";

import { EventPublisher } from "@orpc/server";
import chokidar from "chokidar";
import debug from "debug";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import type { GitHeadEvent } from "../../../shared/plugins/git/contract";

const log = debug("neovate:git:head-watcher");

interface HeadWatchEntry {
  watcher: FSWatcher;
  publisher: EventPublisher<{ "head-changed": GitHeadEvent }>;
  refCount: number;
}

const entries = new Map<string, HeadWatchEntry>();

/**
 * Resolve the actual `.git` directory for a given working tree.
 * Handles the worktree case where `.git` is a file containing `gitdir: <path>`.
 * Returns the directory containing the HEAD file (commondir for worktrees).
 */
function resolveGitDir(cwd: string): string | null {
  const dotGit = path.join(cwd, ".git");
  if (!existsSync(dotGit)) return null;

  try {
    const stat = statSync(dotGit);
    if (stat.isDirectory()) return dotGit;

    // .git is a file (worktree) — read pointer
    const content = readFileSync(dotGit, "utf8").trim();
    const match = content.match(/^gitdir:\s*(.+)$/m);
    if (!match) return null;
    const gitdirRaw = match[1].trim();
    const gitdir = path.isAbsolute(gitdirRaw) ? gitdirRaw : path.resolve(cwd, gitdirRaw);
    return existsSync(gitdir) ? gitdir : null;
  } catch (err) {
    log("resolveGitDir error: cwd=%s err=%O", cwd, err);
    return null;
  }
}

export function acquireHeadPublisher(cwd: string) {
  const existing = entries.get(cwd);
  if (existing) {
    existing.refCount++;
    log("acquire: reuse cwd=%s refCount=%d", cwd, existing.refCount);
    return existing.publisher;
  }

  const gitDir = resolveGitDir(cwd);
  if (!gitDir) {
    log("acquire: not a git repo cwd=%s", cwd);
    // Return an empty publisher so the subscription doesn't crash; it just emits nothing.
    const publisher = new EventPublisher<{ "head-changed": GitHeadEvent }>();
    entries.set(cwd, {
      watcher: chokidar.watch([], { persistent: false }),
      publisher,
      refCount: 1,
    });
    return publisher;
  }

  const headFile = path.join(gitDir, "HEAD");
  log("acquire: creating watcher cwd=%s gitDir=%s", cwd, gitDir);
  const watcher = chokidar.watch(headFile, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });
  const publisher = new EventPublisher<{ "head-changed": GitHeadEvent }>();

  watcher
    .on("change", () => {
      log("HEAD changed cwd=%s", cwd);
      publisher.publish("head-changed", { timestamp: Date.now() });
    })
    .on("add", () => {
      log("HEAD added cwd=%s", cwd);
      publisher.publish("head-changed", { timestamp: Date.now() });
    })
    .on("error", (err) => {
      log("watcher error cwd=%s err=%O", cwd, err);
    });

  entries.set(cwd, { watcher, publisher, refCount: 1 });
  return publisher;
}

export function releaseHeadPublisher(cwd: string) {
  const entry = entries.get(cwd);
  if (!entry) return;
  entry.refCount--;
  log("release: cwd=%s refCount=%d", cwd, entry.refCount);
  if (entry.refCount <= 0) {
    void entry.watcher.close();
    entries.delete(cwd);
    log("release: closed cwd=%s", cwd);
  }
}
