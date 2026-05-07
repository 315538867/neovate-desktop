/**
 * Agent Orchestrator — Sandbox health check.
 *
 * Before resuming an interrupted run that wrote into a worktree, the
 * recovery flow must confirm the worktree directory still exists and
 * looks like a worktree (i.e. has a `.git` entry — git worktrees plant
 * a file rather than a directory). Anything missing is surfaced as a
 * `reason` so the UI can render a meaningful error.
 *
 * No git commands are issued here — this validator is intentionally
 * cheap (existsSync + stat) so it can run during eager startup polling.
 */

import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

export type SandboxValidationReason =
  | "missing-sandbox-path"
  | "not-a-directory"
  | "stat-failed"
  | "missing-git-marker";

export type SandboxValidationResult = {
  valid: boolean;
  /** Path is reachable on disk. */
  exists: boolean;
  reason?: SandboxValidationReason;
  /** Free-form detail (`stat-failed` propagates the underlying message). */
  detail?: string;
};

export async function validateSandbox(
  sandboxPath: string | undefined,
): Promise<SandboxValidationResult> {
  if (!sandboxPath) {
    // No sandbox declared — treat as valid no-op.
    return { valid: true, exists: false };
  }

  if (!existsSync(sandboxPath)) {
    return { valid: false, exists: false, reason: "missing-sandbox-path" };
  }

  try {
    const s = await stat(sandboxPath);
    if (!s.isDirectory()) {
      return { valid: false, exists: true, reason: "not-a-directory" };
    }
  } catch (err) {
    return {
      valid: false,
      exists: true,
      reason: "stat-failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // Worktrees plant `.git` as a file; bare clones plant it as a directory.
  // Either way the marker must exist.
  const gitMarker = path.join(sandboxPath, ".git");
  if (!existsSync(gitMarker)) {
    return { valid: false, exists: true, reason: "missing-git-marker" };
  }

  return { valid: true, exists: true };
}
