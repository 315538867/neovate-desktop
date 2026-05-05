import type {
  Query,
  Options,
  SDKUserMessage,
  PermissionMode as SDKPermissionMode,
} from "@anthropic-ai/claude-agent-sdk";

import { EventPublisher } from "@orpc/server";
import debug from "debug";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

import type {
  ClaudeCodeUIEvent,
  ClaudeCodeUIMessage,
  ClaudeCodeUIMessageChunk,
  ClaudeCodeUIDispatch,
  ClaudeCodeUIDispatchResult,
} from "../../../shared/claude-code/types";
import type {
  ActiveSessionInfo,
  ModelScope,
  RewindFilesResult,
  RewindResult,
  SessionInfo,
  SessionLifecycleEvent,
} from "../../../shared/features/agent/types";
import type { Provider } from "../../../shared/features/provider/types";
import type { Contributions } from "../../core/plugin/contributions";
import type { ConfigStore } from "../config/config-store";
import type { ProjectStore } from "../project/project-store";
import type { RequestTracker } from "./request-tracker";

import { extractReadableUserText } from "../../../shared/claude-code/extract-readable-user-text";
import { lookupContextWindow } from "../../../shared/claude-code/model-context-windows";
import { mergeAgentContributions } from "../../core/plugin/contributions";
import { PowerBlockerService } from "../../core/power-blocker-service";
import { shellEnvService } from "../../core/shell-service";
import {
  resolveBunPath,
  resolveClaudeCodeExecutable,
  resolveRtkPath,
  detectRtkHookInSettings,
} from "./claude-code-utils";
import { readModelSetting, readProviderSetting, readProviderModelSetting } from "./claude-settings";
import { Pushable } from "./pushable";
import { SDKMessageTransformer, toUIEvent } from "./sdk-message-transformer";
import {
  buildProviderSettings,
  buildSessionEnv,
  createRtkHook,
  createSpawnOverride,
} from "./session/lifecycle";
import {
  findPrevMessageId,
  lastTurnDiff as lastTurnDiffFn,
  lastTurnFiles as lastTurnFilesFn,
  resolveForkLastMessageId,
  resolveSdkMessageId,
  rewindFilesDryRun as rewindFilesDryRunFn,
} from "./session/rewind-fork";
import {
  appendCustomTitle,
  archiveSessionFiles,
  buildBirthtimeMap,
  deleteSessionFiles,
  projectSessionInfo,
} from "./session/store";
import { INIT_TIMEOUT_MS, type SessionEntry } from "./session/types";
import { sessionMessagesToUIMessages } from "./utils/session-messages-to-ui-messages";

const log = debug("neovate:session-manager");
const rtkLog = debug("neovate:rtk");

export class SessionManager {
  // Single global publisher — sessionId is the channel key
  readonly eventPublisher = new EventPublisher<Record<string, ClaudeCodeUIEvent>>();

  // Per-session state
  private sessions = new Map<string, SessionEntry>();

  private lifecycleListeners: Array<(event: SessionLifecycleEvent) => void> = [];
  private emittedCreatedSessions = new Set<string>();
  private closingSessions = new Set<string>();

  constructor(
    private configStore: ConfigStore,
    private projectStore: ProjectStore,
    private requestTracker: RequestTracker,
    private powerBlocker: PowerBlockerService,
    private getAgentContributions: () => Contributions["agents"] = () => [],
  ) {}

  onLifecycle(listener: (event: SessionLifecycleEvent) => void): () => void {
    this.lifecycleListeners.push(listener);
    return () => {
      this.lifecycleListeners = this.lifecycleListeners.filter((l) => l !== listener);
    };
  }

  private emitLifecycle(event: SessionLifecycleEvent): void {
    for (const listener of this.lifecycleListeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /** Return all in-memory (active) sessions. */
  getActiveSessions(): ActiveSessionInfo[] {
    return Array.from(this.sessions.entries()).map(([sessionId, session]) => ({
      sessionId,
      cwd: session.cwd,
      createdAt: session.createdAt,
      model: session.model,
      providerId: session.providerId,
    }));
  }

  private queryOptions({
    sessionId,
    model,
    cwd,
  }: {
    sessionId: string;
    model?: string;
    cwd: string;
  }): Options {
    const resolved = resolveClaudeCodeExecutable(
      this.configStore.get("claudeCodeBinPath") || undefined,
    );
    return {
      sessionId,
      model,
      cwd,
      pathToClaudeCodeExecutable: resolved.cliPath ?? resolved.executable,
      ...(resolved.standalone ? {} : { executable: "bun" as const }),
      settingSources: ["local", "project", "user"],
      enableFileCheckpointing: true,
      includePartialMessages: true,
      permissionMode: this.configStore.get("permissionMode") ?? "default",
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
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error(`Unknown session: ${sessionId}`);

        const { promise, resolve } =
          Promise.withResolvers<import("@anthropic-ai/claude-agent-sdk").PermissionResult>();
        let settled = false;
        const settle = (
          result: import("@anthropic-ai/claude-agent-sdk").PermissionResult,
        ): boolean => {
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
            this.eventPublisher.publish(sessionId, { kind: "request_settled", requestId });
          }
        };
        session.pendingRequests.set(requestId, { resolve: settle });
        this.eventPublisher.publish(sessionId, {
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

  /** Start a new session. */
  async createSession(
    cwd: string,
    model?: string,
    explicitProviderId?: string | null,
  ): Promise<
    {
      sessionId: string;
      currentModel?: string;
      modelScope?: ModelScope;
      providerId?: string;
    } & Awaited<ReturnType<Query["initializationResult"]>>
  > {
    const sessionId = randomUUID();
    log(
      "createSession: sessionId=%s cwd=%s model=%s explicitProviderId=%s",
      sessionId,
      cwd,
      model ?? "(auto)",
      explicitProviderId ?? "(none)",
    );

    // Resolve provider: explicit param overrides settings chain
    // null = force no provider (SDK Default), undefined = use settings chain
    let provider: Provider | undefined;
    if (explicitProviderId === null) {
      log("createSession: explicit null providerId — forcing SDK Default");
    } else if (explicitProviderId) {
      const p = this.configStore.getProvider(explicitProviderId);
      if (p?.enabled) {
        provider = p;
        log("createSession: using explicit provider=%s", p.name);
      } else {
        log(
          "createSession: explicit provider id=%s not found or disabled, falling through",
          explicitProviderId,
        );
      }
    }
    if (explicitProviderId === undefined && !provider) {
      const providerSetting = await readProviderSetting(
        sessionId,
        cwd,
        this.configStore,
        this.projectStore,
      );
      provider = providerSetting?.provider;
    }

    if (provider && !explicitProviderId) {
      log("createSession: resolved provider=%s from settings", provider.name);
    }

    // Resolve model: explicit param > settings chain (provider-aware or SDK-default)
    // When explicitProviderId === null (force SDK Default), skip model settings
    // to avoid picking up a provider-specific model from the settings chain.
    let modelSetting: { model: string; scope: ModelScope } | undefined;
    if (model) {
      modelSetting = { model, scope: "session" };
    } else if (explicitProviderId === null) {
      // Let SDK use its own defaults
    } else if (provider) {
      modelSetting = await readProviderModelSetting(
        sessionId,
        cwd,
        provider,
        this.configStore,
        this.projectStore,
      );
    } else {
      modelSetting = await readModelSetting(sessionId, cwd);
    }

    log(
      "createSession: resolved model=%s scope=%s providerId=%s",
      modelSetting?.model ?? "(default)",
      modelSetting?.scope ?? "(none)",
      provider?.id ?? "(none)",
    );

    const initResult = await this.initSessionWithTimeout(sessionId, cwd, {
      model: modelSetting?.model,
      provider,
    });

    return {
      ...initResult,
      sessionId,
      currentModel: modelSetting?.model,
      modelScope: modelSetting?.scope,
      providerId: provider?.id,
    };
  }

  /** Resume an existing session, returning converted historical messages. */
  async loadSession(
    sessionId: string,
    cwd: string,
  ): Promise<{
    sessionId: string;
    capabilities: Awaited<ReturnType<Query["initializationResult"]>>;
    messages: ClaudeCodeUIMessage[];
    currentModel?: string;
    modelScope?: ModelScope;
    providerId?: string;
  }> {
    // Resolve provider
    const providerSetting = await readProviderSetting(
      sessionId,
      cwd,
      this.configStore,
      this.projectStore,
    );
    const provider = providerSetting?.provider;

    if (provider) {
      log("loadSession: resolved provider=%s scope=%s", provider.name, providerSetting!.scope);
    }

    // Read persisted model setting before initializing SDK query
    const modelSetting = provider
      ? await readProviderModelSetting(
          sessionId,
          cwd,
          provider,
          this.configStore,
          this.projectStore,
        )
      : await readModelSetting(sessionId, cwd);

    // Run SDK session init and on-disk message hydration in parallel:
    // they are independent (getSessionMessages just reads the .jsonl file
    // and does not require the resumed query to be live). This typically
    // shaves the smaller of the two off the perceived load latency.
    const { getSessionMessages } = await import("@anthropic-ai/claude-agent-sdk");
    const [capabilities, sessionMessages] = await Promise.all([
      this.initSessionWithTimeout(sessionId, cwd, {
        model: modelSetting?.model,
        resume: sessionId,
        provider,
      }),
      getSessionMessages(sessionId, { includeSystemMessages: true }),
    ]);
    const messages = await sessionMessagesToUIMessages(sessionMessages);

    log(
      "loadSession: sessionId=%s raw=%d messages=%d currentModel=%s modelScope=%s providerId=%s",
      sessionId,
      sessionMessages.length,
      messages.length,
      modelSetting?.model ?? "(default)",
      modelSetting?.scope ?? "(none)",
      provider?.id ?? "(none)",
    );

    return {
      sessionId,
      capabilities,
      messages,
      currentModel: modelSetting?.model,
      modelScope: modelSetting?.scope,
      providerId: provider?.id,
    };
  }

  /** Shared session initialization: shell env, query, canUseTool wiring. */
  private async initSession(
    sessionId: string,
    cwd: string,
    opts?: {
      model?: string;
      resume?: string;
      provider?: Provider;
    },
  ): Promise<Awaited<ReturnType<Query["initializationResult"]>>> {
    const input = new Pushable<SDKUserMessage>();
    const pendingRequests = new Map<
      string,
      {
        resolve: (result: import("@anthropic-ai/claude-agent-sdk").PermissionResult) => void;
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

    const agentLanguage = this.configStore.get("agentLanguage");

    // RTK token optimization hook
    const tokenOptimization = this.configStore.get("tokenOptimization") !== false;
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
    const resolved = resolveClaudeCodeExecutable(
      this.configStore.get("claudeCodeBinPath") || undefined,
    );
    log(
      "initSession: executable=%s standalone=%s cliPath=%s sessionId=%s",
      resolved.executable,
      resolved.standalone,
      resolved.cliPath ?? "(none)",
      sessionId,
    );

    // Network inspector UI is controlled by networkInspector setting,
    // but we always inject the interceptor to collect usage stats
    const networkInspectorUI = this.configStore.get("networkInspector") === true;
    if (networkInspectorUI) {
      this.requestTracker.markInspectorEnabled(sessionId);
    }

    const queryOpts = this.queryOptions({
      sessionId,
      cwd,
      model: opts?.model,
    });
    // Merge plugin-contributed hooks and MCP servers
    const merged = mergeAgentContributions(this.getAgentContributions());
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
      requestTracker: this.requestTracker,
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
    this.sessions.set(sessionId, {
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
      if (!this.sessions.has(sessionId)) {
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
    this.consume(sessionId).catch((err) => log("consume error for %s: %o", sessionId, err));
    return initResult;
  }

  /** Wrap initSession with a timeout to prevent hanging sessions. */
  private async initSessionWithTimeout(
    sessionId: string,
    cwd: string,
    opts?: {
      model?: string;
      resume?: string;
      provider?: Provider;
    },
  ): Promise<Awaited<ReturnType<Query["initializationResult"]>>> {
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
      const result = await Promise.race([this.initSession(sessionId, cwd, opts), timeoutPromise]);
      clearTimeout(timer!);
      return result;
    } catch (err) {
      clearTimeout(timer!);
      await this.closeSession(sessionId);
      throw err;
    }
  }

  async listSessions(cwd?: string): Promise<SessionInfo[]> {
    const t0 = performance.now();

    const { listSessions: sdkListSessions } = await import("@anthropic-ai/claude-agent-sdk");
    const sessions = await sdkListSessions(cwd ? { dir: cwd } : undefined);

    // Build sessionId -> file birthtime map for accurate createdAt
    const birthtimeMap = await buildBirthtimeMap();

    const result = projectSessionInfo(sessions, birthtimeMap);

    log("listSessions: DONE in %dms count=%d", Math.round(performance.now() - t0), result.length);
    return result;
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    log("renameSession: sessionId=%s title=%s", sessionId, title);
    await appendCustomTitle(sessionId, title);
    log("renameSession: DONE sessionId=%s", sessionId);
  }

  getSessionCwd(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    return session.cwd;
  }

  getSessionProviderId(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.providerId;
  }

  async closeSession(sessionId: string): Promise<void> {
    const t0 = performance.now();
    const el = (step: string) =>
      log(
        "closeSession TIMING %s sessionId=%s %dms",
        step,
        sessionId,
        Math.round(performance.now() - t0),
      );

    if (this.closingSessions.has(sessionId)) {
      log("closeSession: no-op, already closing sessionId=%s", sessionId);
      return;
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      log("closeSession: no-op, unknown sessionId=%s", sessionId);
      return;
    }
    this.closingSessions.add(sessionId);
    try {
      session.query.close();
    } catch (err) {
      log("closeSession: query.close error sessionId=%s err=%o", sessionId, err);
    }
    el("query.close");
    for (const [requestId, pending] of session.pendingRequests) {
      pending.resolve({ behavior: "deny", message: "Session closed" });
      this.eventPublisher.publish(sessionId, { kind: "request_settled", requestId });
    }
    el("pendingRequests.settled");
    this.sessions.delete(sessionId);
    this.emittedCreatedSessions.delete(sessionId);
    this.closingSessions.delete(sessionId);
    this.requestTracker.clearSession(sessionId);
    this.powerBlocker.onSessionClosed(sessionId);
    el("cleanup.done");
    log("closeSession: closed sessionId=%s remainingSessions=%d", sessionId, this.sessions.size);
  }

  async closeAll(): Promise<void> {
    log("closeAll: START sessions=%d", this.sessions.size);
    for (const sessionId of this.sessions.keys()) {
      await this.closeSession(sessionId);
    }
    log("closeAll: DONE");
  }

  /** Get the list of files changed in the last agent turn. */
  async lastTurnFiles(sessionId: string): Promise<RewindFilesResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    return lastTurnFilesFn(session);
  }

  /** Get the diff for a single file changed in the last agent turn. */
  async lastTurnDiff(
    sessionId: string,
    file: string,
  ): Promise<{
    success: boolean;
    data?: { oldContent: string; newContent: string };
    error?: string;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    return lastTurnDiffFn(session, file);
  }

  /** Dry-run: get the list of files that would change if we rewound to this message. */
  async rewindFilesDryRun(sessionId: string, messageId: string): Promise<RewindFilesResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    return rewindFilesDryRunFn(session, messageId);
  }

  /**
   * Rewind to a specific user message: optionally restore files, then fork the
   * conversation so the SDK's in-memory state matches the truncated history.
   */
  async rewindToMessage(
    sessionId: string,
    messageId: string,
    restoreFiles: boolean,
    title?: string,
  ): Promise<RewindResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    const sdkMessageId = resolveSdkMessageId(session, messageId);

    // 1. Restore files if requested (on the ORIGINAL session, which has file history)
    if (restoreFiles) {
      await session.query.rewindFiles(sdkMessageId, { dryRun: false });
    }

    // 2. Resolve the message immediately before the target for the fork point
    const prevMessageId = await findPrevMessageId(sessionId, sdkMessageId);

    // 3. Fork the conversation
    const { forkSession } = await import("@anthropic-ai/claude-agent-sdk");
    let forkedSessionId: string;
    if (prevMessageId) {
      const result = await forkSession(sessionId, {
        upToMessageId: prevMessageId,
        dir: session.cwd,
        title,
      });
      forkedSessionId = result.sessionId;
    } else {
      // Rewinding to first message — create a fresh session
      const result = await this.createSession(session.cwd);
      forkedSessionId = result.sessionId;
    }

    // 4. Close original session's Query (keep .jsonl on disk)
    await this.closeSession(sessionId);

    log(
      "rewindToMessage: original=%s forked=%s restoreFiles=%s",
      sessionId,
      forkedSessionId,
      restoreFiles,
    );

    return { forkedSessionId, originalSessionId: sessionId };
  }

  /**
   * Fork an entire session: create a new session with all conversation history.
   * Works for both active (in-memory) and persisted-only (cold) sessions.
   */
  async forkSession(
    sessionId: string,
    cwd: string,
    title?: string,
  ): Promise<{ forkedSessionId: string; originalSessionId: string }> {
    const forkTitle = title ? `${title} (Fork)` : "(Fork)";

    // Find the last message ID — needed by SDK's forkSession
    const { forkSession } = await import("@anthropic-ai/claude-agent-sdk");

    const lastMessageId = await resolveForkLastMessageId(sessionId, this.sessions.get(sessionId));

    const result = await forkSession(sessionId, {
      upToMessageId: lastMessageId,
      dir: cwd,
      title: forkTitle,
    });

    const now = new Date().toISOString();
    this.emitLifecycle({
      type: "created",
      session: {
        sessionId: result.sessionId,
        cwd,
        createdAt: now,
        updatedAt: now,
        title: forkTitle,
      },
    });

    log("forkSession: original=%s forked=%s", sessionId, result.sessionId);

    return { forkedSessionId: result.sessionId, originalSessionId: sessionId };
  }

  /** Delete a session's .jsonl file from disk. */
  async deleteSessionFile(sessionId: string): Promise<void> {
    await deleteSessionFiles(sessionId, log);

    const now = new Date().toISOString();
    this.emitLifecycle({
      type: "deleted",
      session: { sessionId, createdAt: now, updatedAt: now },
    });
  }

  /**
   * Back up a session's .jsonl to ~/.neovate-desktop/rewind-history/ then delete the original.
   * Backup is atomic: delete only runs after the copy succeeds.
   */
  async archiveSessionFile(
    sessionId: string,
    meta: {
      forkedSessionId: string;
      rewindMessageId: string;
      restoreFiles: boolean;
      title?: string;
      cwd?: string;
    },
  ): Promise<void> {
    await archiveSessionFiles(sessionId, meta, log);
  }

  /**
   * Send a user message into the session's input Pushable.
   * Does NOT consume the query iterator — that is handled by consume().
   */
  async send(
    sessionId: string,
    message: import("../../../shared/claude-code/types").ClaudeCodeUIMessage,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    if (session.consumeExited) throw new Error(`Session consume loop has exited: ${sessionId}`);

    // UIMessage -> SDKUserMessage: collapse text + slash-command parts back to
    // their plain-text form (e.g. `data-slash-command{name:"zcf:workflow"}` →
    // `/zcf:workflow`). Filtering by `type:"text"` here would silently drop the
    // command name, causing the SDK to receive only the trailing args and never
    // recognise the slash command on either expansion or persistence.
    const text = extractReadableUserText(message.parts);

    // Emit lifecycle "created" on first message (not on createSession, so empty sessions don't appear)
    if (!this.emittedCreatedSessions.has(sessionId)) {
      this.emittedCreatedSessions.add(sessionId);
      const now = new Date().toISOString();
      this.emitLifecycle({
        type: "created",
        session: {
          sessionId,
          cwd: session.cwd,
          createdAt: now,
          updatedAt: now,
          title: text.slice(0, 50),
        },
      });
    }

    const imageBlocks = message.parts
      .filter(
        (p): p is { type: "file"; mediaType: string; url: string } =>
          p.type === "file" &&
          typeof (p as any).mediaType === "string" &&
          (p as any).mediaType.startsWith("image/"),
      )
      .map((p) => {
        const base64 = p.url.startsWith("data:") ? p.url.split(",")[1] : p.url;
        return {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: p.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: base64,
          },
        };
      });

    const pdfBlocks = message.parts
      .filter(
        (p): p is { type: "file"; mediaType: string; url: string } =>
          p.type === "file" &&
          typeof (p as any).mediaType === "string" &&
          (p as any).mediaType === "application/pdf",
      )
      .map((p) => {
        const base64 = p.url.startsWith("data:") ? p.url.split(",")[1] : p.url;
        return {
          type: "document" as const,
          source: {
            type: "base64" as const,
            media_type: "application/pdf" as const,
            data: base64,
          },
        };
      });

    const mediaBlocks = [...imageBlocks, ...pdfBlocks];
    const content =
      mediaBlocks.length > 0
        ? [...(text ? [{ type: "text" as const, text }] : []), ...mediaBlocks]
        : text;

    // Pre-turn snapshot: capture working tree state before Claude modifies files
    let preTurnRef: string | undefined;
    try {
      const { stdout } = await execFileAsync("git", ["stash", "create"], { cwd: session.cwd });
      preTurnRef = stdout.trim() || undefined;
    } catch {
      // not a git repo or git not available — skip
    }
    // Fall back to HEAD if working tree was clean (git stash create returns empty)
    if (!preTurnRef) {
      try {
        const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: session.cwd });
        preTurnRef = stdout.trim() || undefined;
      } catch {
        // ignore
      }
    }
    session.preTurnRef = preTurnRef;

    const userMessageId = randomUUID();
    session.lastUserMessageId = userMessageId;
    // Track UI message ID → SDK UUID mapping for rewind
    if (message.id) {
      session.uiToSdkMessageIds.set(message.id, userMessageId);
    }

    this.requestTracker.startTurn(sessionId);
    this.powerBlocker.onTurnStart(sessionId);
    session.input.push({
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      session_id: sessionId,
      uuid: userMessageId,
    });
  }

  /**
   * Long-lived background loop that consumes the query iterator and publishes
   * all events and chunks through the eventPublisher.
   * Started fire-and-forget after initSession(). Does NOT break on result —
   * continues through background turns.
   */
  private async consume(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const transformer = new SDKMessageTransformer();

    // Track the latest top-level message_start usage to compute context window fill
    let lastInputTokens = 0;

    try {
      while (true) {
        const { value, done } = await session.query.next();
        if (done || !value) break;

        // Track context window usage from top-level message_start events
        if (
          value.type === "stream_event" &&
          value.event.type === "message_start" &&
          value.parent_tool_use_id === null
        ) {
          // Non-Anthropic providers (e.g. Wohu/Kimi) may omit usage from message_start
          const usage = value.event.message.usage;
          if (usage) {
            lastInputTokens =
              (usage.input_tokens ?? 0) +
              (usage.cache_creation_input_tokens ?? 0) +
              (usage.cache_read_input_tokens ?? 0);
          }
        }

        // Publish side events to subscribe stream (result event included — carries cost/usage/stop_reason)
        const event = toUIEvent(value);
        if (event) {
          this.eventPublisher.publish(sessionId, event);
        }

        // On result, publish context_usage event with computed remaining %
        if (value.type === "result") {
          const modelEntries = Object.values(value.modelUsage ?? {});
          const modelUsage = modelEntries[0];

          if (session.providerId) {
            // Third-party provider: contextWindow is unreliable (SDK defaults to 200k).
            // Publish cumulative input/output tokens from the API response instead.
            this.eventPublisher.publish(sessionId, {
              kind: "event",
              event: {
                id: randomUUID(),
                type: "context_usage",
                contextWindowSize: 0,
                usedTokens: 0,
                remainingPct: 0,
                totalInputTokens: modelUsage?.inputTokens ?? 0,
                totalOutputTokens: modelUsage?.outputTokens ?? 0,
              },
            });
          } else {
            let contextWindowSize = modelUsage?.contextWindow ?? 0;
            if (!contextWindowSize) {
              // Non-Anthropic providers often omit contextWindow; fall back to a known map.
              contextWindowSize = lookupContextWindow(session.model);
            }
            const remainingPct =
              contextWindowSize > 0
                ? Math.max(
                    0,
                    Math.min(100, Math.round((1 - lastInputTokens / contextWindowSize) * 100)),
                  )
                : 0;
            this.eventPublisher.publish(sessionId, {
              kind: "event",
              event: {
                id: randomUUID(),
                type: "context_usage",
                contextWindowSize,
                usedTokens: lastInputTokens,
                remainingPct,
              },
            });
          }
          this.powerBlocker.onTurnEnd(sessionId);
        }

        // Publish chunks through eventPublisher (wrapped as { kind: "chunk", chunk })
        for await (const chunk of transformer.transformWithAggregation(value)) {
          this.eventPublisher.publish(sessionId, { kind: "chunk", chunk });
        }

        // NO break on result — continue processing background turns
      }
    } catch (err: unknown) {
      const errorText = err instanceof Error ? err.message : String(err);
      this.eventPublisher.publish(sessionId, {
        kind: "chunk",
        chunk: { type: "error", errorText } as ClaudeCodeUIMessageChunk,
      });
    } finally {
      session.consumeExited = true;
      this.powerBlocker.onTurnEnd(sessionId);
    }
  }

  /** Handle dispatch — respond to permission request or configure session */
  async handleDispatch(
    sessionId: string,
    dispatch: ClaudeCodeUIDispatch,
  ): Promise<ClaudeCodeUIDispatchResult> {
    if (dispatch.kind === "respond") {
      const session = this.sessions.get(sessionId);
      if (!session) throw new Error(`Unknown session: ${sessionId}`);
      const pending = session.pendingRequests.get(dispatch.requestId);
      if (!pending) {
        log("handleDispatch: unknown requestId=%s knownIds=%o", dispatch.requestId, [
          ...session.pendingRequests.keys(),
        ]);
        return { kind: "respond", ok: false };
      }
      pending.resolve(dispatch.respond.result);
      session.pendingRequests.delete(dispatch.requestId);
      return { kind: "respond", ok: true };
    }
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);

    if (dispatch.kind === "interrupt") {
      log("handleDispatch: interrupt sessionId=%s", sessionId);
      session.query.interrupt();
      return { kind: "interrupt", ok: true };
    }

    if (dispatch.kind === "configure") {
      const { configure } = dispatch;
      log("handleDispatch: configure type=%s", configure.type);
      switch (configure.type) {
        case "set_permission_mode": {
          log(
            "handleDispatch: set_permission_mode sessionId=%s mode=%s",
            sessionId,
            configure.mode,
          );
          try {
            await session.query.setPermissionMode(configure.mode as SDKPermissionMode);
          } catch (error) {
            log("handleDispatch: set_permission_mode failed: %O", error);
            return {
              kind: "configure",
              ok: false,
              configure,
              error: error instanceof Error ? error.message : String(error),
            };
          }
          return { kind: "configure", ok: true, configure };
        }
        case "set_model": {
          let model = configure.model;
          // Validate model against provider catalog
          if (session.providerId) {
            const provider = this.configStore.getProvider(session.providerId);
            if (provider && !(model in provider.models)) {
              model = provider.modelMap.model ?? Object.keys(provider.models)[0];
              log("handleDispatch: set_model fallback model=%s (not in provider catalog)", model);
            }
          }
          log("handleDispatch: set_model sessionId=%s model=%s", sessionId, model);
          session.query.setModel(model);
          return { kind: "configure", ok: true, configure: { ...configure, model } };
        }
      }
    }

    return { kind: "configure", ok: false, configure: (dispatch as any).configure };
  }
}
