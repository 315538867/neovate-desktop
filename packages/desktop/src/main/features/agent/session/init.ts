/**
 * Session initialization.
 *
 * Pulled out of `SessionManager.initSession` so the manager class stays
 * focused on orchestration. Exposes:
 *
 *   - InitContext: the bundle of manager-owned state (sessions map,
 *     stores, services, callbacks) the helpers need.
 *   - buildQueryOptions: assembles the SDK `Options` object that drives
 *     a Query, including the `canUseTool` permission-request flow.
 *   - initSession: shell-env, provider settings, RTK hook, spawn
 *     override, plugin contributions, then awaits initializationResult
 *     and starts the consume loop.
 *   - initSessionWithTimeout: wraps initSession with INIT_TIMEOUT_MS,
 *     calling closeSession on timeout/error so we don't leak.
 *
 * Behavior must remain bit-for-bit identical to the inlined versions —
 * these are pure refactors, not redesigns.
 */

import type {
  Options,
  Query,
  SDKUserMessage,
  PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import type { EventPublisher } from "@orpc/server";

import { randomUUID } from "node:crypto";
import path from "node:path";

import type { ClaudeCodeUIEvent } from "../../../../shared/claude-code/types";
import type { Provider } from "../../../../shared/features/provider/types";
import type { Contributions } from "../../../core/plugin/contributions";
import type { PowerBlockerService } from "../../../core/power-blocker-service";
import type { ConfigStore } from "../../config/config-store";
import type { RequestTracker } from "../request-tracker";

import { mergeAgentContributions } from "../../../core/plugin/contributions";
import { shellEnvService } from "../../../core/shell-service";
import {
  detectRtkHookInSettings,
  resolveBunPath,
  resolveClaudeCodeExecutable,
  resolveRtkPath,
} from "../claude-code-utils";
import { Pushable } from "../pushable";
import {
  buildProviderSettings,
  buildSessionEnv,
  createRtkHook,
  createSpawnOverride,
} from "./lifecycle";
import { INIT_TIMEOUT_MS, type SessionEntry } from "./types";

/**
 * The slice of SessionManager that initialization touches. Passing it as
 * one bundle keeps each helper's signature small and makes the
 * dependency surface obvious at a glance.
 */
export interface InitContext {
  sessions: Map<string, SessionEntry>;
  configStore: ConfigStore;
  requestTracker: RequestTracker;
  eventPublisher: EventPublisher<Record<string, ClaudeCodeUIEvent>>;
  powerBlocker: PowerBlockerService;
  getAgentContributions: () => Contributions["agents"];
  closeSession: (sessionId: string) => Promise<void>;
  startConsume: (sessionId: string) => void;
  log: (fmt: string, ...args: unknown[]) => void;
  rtkLog: (fmt: string, ...args: unknown[]) => void;
}

/**
 * Assemble the SDK `Options` driving a Query. Wires the canUseTool
 * permission flow that publishes `request` events to the session
 * channel and resolves on dispatch / abort.
 */
export function buildQueryOptions(
  ctx: InitContext,
  params: { sessionId: string; cwd: string; model?: string },
): Options {
  const { sessionId, cwd, model } = params;
  const { configStore, sessions, eventPublisher, log } = ctx;
  const resolved = resolveClaudeCodeExecutable(configStore.get("claudeCodeBinPath") || undefined);
  return {
    sessionId,
    model,
    cwd,
    pathToClaudeCodeExecutable: resolved.cliPath ?? resolved.executable,
    ...(resolved.standalone ? {} : { executable: "bun" as const }),
    settingSources: ["local", "project", "user"],
    enableFileCheckpointing: true,
    includePartialMessages: true,
    permissionMode: configStore.get("permissionMode") ?? "default",
    promptSuggestions: true,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
    },
    tools: {
      type: "preset",
      preset: "claude_code",
    },
    canUseTool: async (toolName, input, { signal, ...options }) => {
      const requestId = randomUUID();
      const session = sessions.get(sessionId);
      if (!session) throw new Error(`Unknown session: ${sessionId}`);

      const { promise, resolve } = Promise.withResolvers<PermissionResult>();
      let settled = false;
      const settle = (result: PermissionResult): boolean => {
        if (settled) return false;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        session.pendingRequests.delete(requestId);
        // SDK expects updatedInput on allow results to execute the tool
        resolve(
          result.behavior === "allow"
            ? { ...result, updatedInput: result.updatedInput ?? input }
            : result,
        );
        return true;
      };
      const onAbort = () => {
        if (settle({ behavior: "deny", message: "Permission request cancelled" })) {
          eventPublisher.publish(sessionId, { kind: "request_settled", requestId });
        }
      };
      session.pendingRequests.set(requestId, { resolve: settle });
      eventPublisher.publish(sessionId, {
        kind: "request",
        requestId,
        request: { type: "permission_request", toolName, input, options },
      });
      signal.addEventListener("abort", onAbort, { once: true });
      return promise;
    },
    stderr(data) {
      log("stderr sessionId=%s: %s", sessionId, data.trimEnd());
    },
  };
}

/**
 * Shared session initialization: shell env, query, canUseTool wiring.
 * Sets the entry in `ctx.sessions`, then fires `ctx.startConsume` once
 * the SDK reports an initializationResult.
 */
export async function initSession(
  ctx: InitContext,
  sessionId: string,
  cwd: string,
  opts?: {
    model?: string;
    resume?: string;
    provider?: Provider;
  },
): Promise<Awaited<ReturnType<Query["initializationResult"]>>> {
  const { configStore, requestTracker, log, rtkLog } = ctx;

  const input = new Pushable<SDKUserMessage>();
  const pendingRequests = new Map<
    string,
    {
      resolve: (result: PermissionResult) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  const t0 = performance.now();
  const shellEnv = await shellEnvService.getEnv();
  const tShellEnv = performance.now();
  log("initSession: TIMING shellEnv=%dms sessionId=%s", Math.round(tShellEnv - t0), sessionId);
  const bunPath = resolveBunPath();
  const bunDir = bunPath !== "bun" ? path.dirname(bunPath) : undefined;
  const rtkPath = resolveRtkPath();
  const rtkDir = rtkPath !== "rtk" ? path.dirname(rtkPath) : undefined;
  const env = buildSessionEnv({ shellEnv, bunDir, rtkDir });

  const provider = opts?.provider;

  // Build settings.env for provider credentials (flag settings layer = highest priority)
  let settingsEnv: Record<string, string> | undefined;
  if (provider) {
    const built = buildProviderSettings({
      provider,
      model: opts?.model,
      env,
      log: (fmt, ...args) => log(`initSession: ${fmt}`, ...args),
    });
    settingsEnv = built.settingsEnv;

    log(
      "initSession: provider=%s baseURL=%s model=%s haiku=%s opus=%s sonnet=%s envOverrides=%o",
      provider.name,
      provider.baseURL,
      settingsEnv.ANTHROPIC_MODEL,
      settingsEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL,
      settingsEnv.ANTHROPIC_DEFAULT_OPUS_MODEL,
      settingsEnv.ANTHROPIC_DEFAULT_SONNET_MODEL,
      built.appliedOverrides,
    );
  }

  const agentLanguage = configStore.get("agentLanguage");

  // RTK token optimization hook
  const tokenOptimization = configStore.get("tokenOptimization") !== false;
  const hasFileBasedRtkHook = detectRtkHookInSettings();
  const registerRtkHook = tokenOptimization && !hasFileBasedRtkHook;

  if (!tokenOptimization) {
    rtkLog("hook skipped (disabled)");
  } else if (hasFileBasedRtkHook) {
    rtkLog("hook skipped (file-based hook detected in ~/.claude/settings.json)");
  } else {
    rtkLog("hook registered rtkPath=%s", rtkPath);
  }

  const rtkHook = createRtkHook({ rtkPath, env, log: rtkLog });

  // Resolve custom Claude Code binary
  const resolved = resolveClaudeCodeExecutable(configStore.get("claudeCodeBinPath") || undefined);
  log(
    "initSession: executable=%s standalone=%s cliPath=%s sessionId=%s",
    resolved.executable,
    resolved.standalone,
    resolved.cliPath ?? "(none)",
    sessionId,
  );

  // Network inspector UI is controlled by networkInspector setting,
  // but we always inject the interceptor to collect usage stats
  const networkInspectorUI = configStore.get("networkInspector") === true;
  if (networkInspectorUI) {
    requestTracker.markInspectorEnabled(sessionId);
  }

  const queryOpts = buildQueryOptions(ctx, {
    sessionId,
    cwd,
    model: opts?.model,
  });
  // Merge plugin-contributed hooks and MCP servers
  const merged = mergeAgentContributions(ctx.getAgentContributions());
  log(
    "initSession: merged contributions sessionId=%s mcpServers=%o hookEvents=%o",
    sessionId,
    Object.keys(merged.mcpServers),
    Object.keys(merged.hooks),
  );
  if (registerRtkHook) {
    (merged.hooks.PreToolUse ??= []).push({ matcher: "Bash", hooks: [rtkHook] });
  }

  const spawnOverride = createSpawnOverride({
    resolved,
    sessionId,
    settingsEnv,
    requestTracker,
    log,
  });

  const options: Options = {
    ...queryOpts,
    allowDangerouslySkipPermissions: true,
    env,
    settings: {
      ...(settingsEnv ? { env: settingsEnv } : {}),
      ...(agentLanguage !== "English" ? { language: agentLanguage.toLowerCase() } : {}),
    },
    hooks: merged.hooks,
    mcpServers: merged.mcpServers,
    ...(opts?.resume ? { resume: opts.resume, sessionId: undefined } : {}),
    ...(spawnOverride ? { spawnClaudeCodeProcess: spawnOverride } : {}),
  };

  const tPreSDK = performance.now();
  log("initSession: TIMING setup=%dms sessionId=%s", Math.round(tPreSDK - tShellEnv), sessionId);
  log("initSession: importing SDK sessionId=%s", sessionId);
  const { query: queryFn } = await import("@anthropic-ai/claude-agent-sdk");
  const tImport = performance.now();
  log("initSession: creating SDK query sessionId=%s", sessionId);
  const q = queryFn({ prompt: input, options });
  const tQuery = performance.now();
  ctx.sessions.set(sessionId, {
    input,
    query: q,
    cwd,
    providerId: provider?.id,
    model: opts?.model,
    createdAt: Date.now(),
    consumeExited: false,
    uiToSdkMessageIds: new Map(),
    pendingRequests,
  });
  log(
    "initSession: TIMING import=%dms query=%dms sessionId=%s",
    Math.round(tImport - tPreSDK),
    Math.round(tQuery - tImport),
    sessionId,
  );
  log("initSession: awaiting initializationResult sessionId=%s", sessionId);
  let initResult: Awaited<ReturnType<Query["initializationResult"]>>;
  try {
    initResult = await q.initializationResult();
  } catch (err) {
    if (!ctx.sessions.has(sessionId)) {
      log("initSession: session closed during init sessionId=%s", sessionId);
      throw new Error("Session closed during initialization");
    }
    throw err;
  }
  const tInit = performance.now();
  log(
    "initSession: TIMING initResult=%dms total=%dms sessionId=%s",
    Math.round(tInit - tQuery),
    Math.round(tInit - t0),
    sessionId,
  );
  ctx.startConsume(sessionId);
  return initResult;
}

/** Wrap initSession with a timeout to prevent hanging sessions. */
export async function initSessionWithTimeout(
  ctx: InitContext,
  sessionId: string,
  cwd: string,
  opts?: {
    model?: string;
    resume?: string;
    provider?: Provider;
  },
): Promise<Awaited<ReturnType<Query["initializationResult"]>>> {
  const { log } = ctx;
  let timer: ReturnType<typeof setTimeout>;
  const t0 = performance.now();
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      log(
        "initSessionWithTimeout: TIMEOUT after %dms sessionId=%s",
        Math.round(performance.now() - t0),
        sessionId,
      );
      reject(new Error("Session initialization timed out"));
    }, INIT_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([initSession(ctx, sessionId, cwd, opts), timeoutPromise]);
    clearTimeout(timer!);
    return result;
  } catch (err) {
    clearTimeout(timer!);
    await ctx.closeSession(sessionId);
    throw err;
  }
}
