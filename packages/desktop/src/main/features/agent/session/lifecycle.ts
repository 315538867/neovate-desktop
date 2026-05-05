/**
 * Session lifecycle helpers.
 *
 * Pulled out of `SessionManager.initSession` so the manager class can stay
 * focused on orchestration. Each helper here is either pure (env builders)
 * or a factory that returns the closure the SDK needs (RTK hook, spawn
 * override). Behavior must remain bit-for-bit identical to the inlined
 * versions — these are pure refactors, not redesigns.
 */

import type { HookCallback, SpawnedProcess, SpawnOptions } from "@anthropic-ai/claude-agent-sdk";

import { type ChildProcess, execFile, spawn } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

import type { Provider } from "../../../../shared/features/provider/types";
import type { ClaudeCodeExecutableInfo } from "../claude-code-utils";
import type { RequestTracker } from "../request-tracker";

import { resolveInterceptorPath } from "../claude-code-utils";
import { ENV_BLOCKLIST } from "./types";

const execFileAsync = promisify(execFile);

export type SessionEnv = Record<string, string | undefined>;
export type SettingsEnv = Record<string, string>;

/**
 * Build the spawned-subprocess env: shell env, plus bun/rtk dirs prepended
 * to PATH and the SDK's session-state-event flag.
 */
export function buildSessionEnv(opts: {
  shellEnv: SessionEnv;
  bunDir: string | undefined;
  rtkDir: string | undefined;
}): SessionEnv {
  const mergedPath = [opts.rtkDir, opts.bunDir, opts.shellEnv.PATH]
    .filter(Boolean)
    .join(path.delimiter);
  return {
    ...opts.shellEnv,
    PATH: mergedPath,
    CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
  };
}

/**
 * Build the provider-specific `settings.env` block (highest-priority
 * settings layer), and apply provider `envOverrides` to both `settingsEnv`
 * and process `env`. Returns the list of applied override keys for logging.
 */
export function buildProviderSettings(opts: {
  provider: Provider;
  model?: string;
  env: SessionEnv;
  log: (fmt: string, ...args: unknown[]) => void;
}): { settingsEnv: SettingsEnv; appliedOverrides: string[] } {
  const { provider, model, env, log } = opts;

  // Remove ANTHROPIC_API_KEY from process env to avoid conflicts
  delete env.ANTHROPIC_API_KEY;

  const fallback = provider.modelMap.model ?? Object.keys(provider.models)[0];
  const settingsEnv: SettingsEnv = {
    ANTHROPIC_AUTH_TOKEN: provider.apiKey,
    ANTHROPIC_BASE_URL: provider.baseURL,
    ANTHROPIC_MODEL: model ?? fallback,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: provider.modelMap.haiku ?? fallback,
    ANTHROPIC_DEFAULT_OPUS_MODEL: provider.modelMap.opus ?? fallback,
    ANTHROPIC_DEFAULT_SONNET_MODEL: provider.modelMap.sonnet ?? fallback,
  };

  const appliedOverrides: string[] = [];
  for (const [key, value] of Object.entries(provider.envOverrides)) {
    if (ENV_BLOCKLIST.has(key)) {
      log("buildProviderSettings: skipped blocked envOverride key=%s", key);
      continue;
    }
    if (value === "") {
      delete env[key];
      appliedOverrides.push(`-${key}`);
    } else {
      settingsEnv[key] = value;
      appliedOverrides.push(key);
    }
  }

  return { settingsEnv, appliedOverrides };
}

/**
 * Build the RTK PreToolUse hook callback. Returns a function the SDK can
 * register; it shells out to `rtk rewrite` for Bash commands and rewrites
 * the input on success.
 */
export function createRtkHook(opts: {
  rtkPath: string;
  env: SessionEnv;
  log: (fmt: string, ...args: unknown[]) => void;
}): HookCallback {
  const { rtkPath, env, log } = opts;
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return { continue: true };
    const cmd = (input.tool_input as Record<string, unknown>)?.command;
    if (typeof cmd !== "string" || !cmd) return { continue: true };

    // Fast skip: commands RTK never rewrites
    if (cmd.startsWith("rtk ") || cmd.includes("<<")) {
      return { continue: true };
    }

    try {
      const { stdout } = await execFileAsync(rtkPath, ["rewrite", cmd], {
        timeout: 5000,
        env: env as Record<string, string>,
      });
      const rewritten = stdout.trim();

      if (!rewritten || rewritten === cmd) {
        log("no rewrite: %s", cmd);
        return { continue: true };
      }

      log("rewrite: %s -> %s", cmd, rewritten);
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse" as const,
          permissionDecision: "allow" as const,
          updatedInput: { command: rewritten },
        },
      };
    } catch (err: unknown) {
      // Normal: rtk rewrite exits 1 when no rewrite applies
      const e = err as { code?: number; status?: number; message?: string };
      if (e?.code === 1 || e?.status === 1) {
        log("no rewrite: %s", cmd);
      } else {
        log("fallback (error): %s — %s", cmd, e?.message ?? err);
      }
      return { continue: true };
    }
  };
}

/**
 * Build the `spawnClaudeCodeProcess` override. Two flavours:
 *
 *   - Standalone binary: spawn the binary directly, no fetch interception.
 *   - Non-standalone: inject `--preload <interceptor>` and pipe an extra
 *     fd 3 IPC stream the interceptor writes per-request stats into.
 */
export function createSpawnOverride(opts: {
  resolved: ClaudeCodeExecutableInfo;
  sessionId: string;
  settingsEnv: SettingsEnv | undefined;
  requestTracker: RequestTracker;
  log: (fmt: string, ...args: unknown[]) => void;
}): (spawnOpts: SpawnOptions) => SpawnedProcess {
  const { resolved, sessionId, settingsEnv, requestTracker, log } = opts;

  if (resolved.standalone) {
    return (spawnOpts) =>
      spawn(resolved.executable, spawnOpts.args, {
        cwd: spawnOpts.cwd,
        env: spawnOpts.env,
        signal: spawnOpts.signal,
        stdio: ["pipe", "pipe", "pipe"],
      }) as unknown as SpawnedProcess;
  }

  return (spawnOpts) => {
    const interceptorPath = resolveInterceptorPath();
    log("spawnClaudeCodeProcess: interceptor=%s sessionId=%s", interceptorPath, sessionId);

    const child: ChildProcess = spawn(
      spawnOpts.command,
      ["--preload", interceptorPath, ...spawnOpts.args],
      {
        cwd: spawnOpts.cwd,
        env: {
          ...spawnOpts.env,
          NV_SESSION_ID: sessionId,
          ...(settingsEnv?.ANTHROPIC_BASE_URL
            ? { ANTHROPIC_BASE_URL: settingsEnv.ANTHROPIC_BASE_URL }
            : {}),
        },
        signal: spawnOpts.signal,
        stdio: ["pipe", "pipe", "pipe", "pipe"],
      },
    );

    // Read interceptor data from fd 3 (dedicated IPC pipe)
    let interceptorReady = false;
    const ipcStream = child.stdio[3];
    if (ipcStream && "on" in ipcStream) {
      const rl = createInterface({ input: ipcStream as NodeJS.ReadableStream });
      rl.on("line", (line: string) => {
        if (line === "__NV_READY") {
          interceptorReady = true;
          log("interceptor ready: sessionId=%s", sessionId);
          return;
        }
        if (!line.startsWith("__NV_REQ:")) {
          log("interceptor fd3 unknown line: %s", line.slice(0, 100));
          return;
        }
        try {
          const msg = JSON.parse(line.slice("__NV_REQ:".length));
          requestTracker.onMessage(sessionId, msg);
        } catch (err) {
          log(
            "interceptor fd3 parse error: %s line=%s",
            err instanceof Error ? err.message : err,
            line.slice(0, 200),
          );
        }
      });
    }

    setTimeout(() => {
      if (!interceptorReady) {
        log("WARNING: network interceptor did not initialize — sessionId=%s", sessionId);
        requestTracker.markInspectorFailed(sessionId);
      }
    }, 5000);

    return child as unknown as SpawnedProcess;
  };
}
