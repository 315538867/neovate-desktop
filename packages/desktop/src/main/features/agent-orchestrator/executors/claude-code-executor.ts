/**
 * Agent Orchestrator — Claude Code executor.
 *
 * Runs a stage by spinning up a Claude Agent SDK session via the
 * existing `SessionManager`, sending the rendered prompt as the first
 * user turn, and consuming the event publisher until the session
 * reports a `result`.
 *
 * Reuses (does NOT modify) SessionManager so the orchestrator path
 * stays orthogonal to the day-to-day chat path. Wave 3.1 invariant:
 * "正交不耦合 — 复用基础设施,不修改它"。
 */

import debug from "debug";

import type { ClaudeCodeUIEvent, ClaudeCodeUIMessage } from "../../../../shared/claude-code/types";
import type { SessionManager } from "../../agent/session-manager";
import type { Executor, ExecutorContext, ExecutorInput, ExecutorResult } from "./types";

const log = debug("neovate:orchestrator:claude-code");

export type ClaudeCodeExecutorDeps = {
  sessionManager: SessionManager;
  /**
   * Hard cap on a single stage's wall-clock — defends against runaway
   * sessions when stage-level timeouts haven't been wired yet.
   */
  defaultStageTimeoutMs?: number;
};

export class ClaudeCodeExecutor implements Executor {
  readonly kind = "claude-code" as const;

  constructor(private readonly deps: ClaudeCodeExecutorDeps) {}

  async execute(input: ExecutorInput, ctx: ExecutorContext): Promise<ExecutorResult> {
    const { runId, stage, branchIndex, cwd, prompt, signal } = input;
    log("execute START runId=%s stage=%s branch=%d cwd=%s", runId, stage.id, branchIndex, cwd);

    if (signal.aborted) {
      throw new Error(`[orchestrator] aborted before start (reason=${signal.reason ?? "unknown"})`);
    }

    const session = await this.deps.sessionManager.createSession(cwd, stage.model);
    const sessionId = session.sessionId;
    log(
      "createSession sessionId=%s currentModel=%s",
      sessionId,
      session.currentModel ?? "(default)",
    );

    const onAbort = () => {
      this.deps.sessionManager.closeSession(sessionId).catch((err) => {
        log("abort-close error sessionId=%s err=%o", sessionId, err);
      });
    };
    signal.addEventListener("abort", onAbort);

    const startedAt = Date.now();
    const accumulator: ResultAccumulator = {
      inputTokens: 0,
      outputTokens: 0,
      totalCostUsd: 0,
      changedFiles: new Set<string>(),
      summary: "",
    };
    const subscriber = this.deps.sessionManager.eventPublisher.subscribe(sessionId);

    try {
      const initialMessage: ClaudeCodeUIMessage = {
        id: `${runId}-${stage.id}-${branchIndex}-0`,
        role: "user",
        parts: [{ type: "text", text: prompt }],
      };
      await this.deps.sessionManager.send(sessionId, initialMessage);

      const timeoutMs = stage.budget?.maxDurationMs ?? this.deps.defaultStageTimeoutMs ?? 0;
      const timeoutHandle = timeoutMs > 0 ? setTimeout(onAbort, timeoutMs) : undefined;

      try {
        for await (const event of subscriber) {
          if (signal.aborted) break;
          const reachedResult = consumeEvent(event, ctx, accumulator);
          if (reachedResult) break;
        }
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      try {
        await this.deps.sessionManager.closeSession(sessionId);
      } catch (err) {
        log("closeSession error sessionId=%s err=%o", sessionId, err);
      }
    }

    const durationMs = Date.now() - startedAt;
    log(
      "execute DONE runId=%s stage=%s sessionId=%s durMs=%d tokensIn=%d tokensOut=%d files=%d",
      runId,
      stage.id,
      sessionId,
      durationMs,
      accumulator.inputTokens,
      accumulator.outputTokens,
      accumulator.changedFiles.size,
    );

    return {
      output: {
        payload: {
          sessionId,
          summary: accumulator.summary,
        },
        summary: accumulator.summary.slice(0, 4096) || undefined,
        changedFiles: Array.from(accumulator.changedFiles),
      },
      usage: {
        usedTokens: accumulator.inputTokens + accumulator.outputTokens,
        usedDurationMs: durationMs,
        usedCostUsd: accumulator.totalCostUsd,
        completedStages: 1,
      },
    };
  }
}

type ResultAccumulator = {
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
  changedFiles: Set<string>;
  summary: string;
};

/**
 * Returns true once a terminal `result` event is observed and the
 * loop should exit. `event` shapes are sourced from
 * `ClaudeCodeUIEvent` (see shared/claude-code/types.ts).
 */
function consumeEvent(
  event: ClaudeCodeUIEvent,
  ctx: ExecutorContext,
  acc: ResultAccumulator,
): boolean {
  if (event.kind !== "event") return false;
  const part = event.event;
  // `result` — terminal signal carrying usage + cost.
  if ("type" in part && part.type === "result") {
    const usage = part.usage ?? { input_tokens: 0, output_tokens: 0 };
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    if (inputTokens || outputTokens) {
      ctx.emitProgress({ kind: "tokens", deltaInput: inputTokens, deltaOutput: outputTokens });
    }
    acc.inputTokens += inputTokens;
    acc.outputTokens += outputTokens;
    acc.totalCostUsd += part.total_cost_usd ?? 0;
    if (part.subtype === "success" && typeof part.result === "string") {
      acc.summary = part.result;
    }
    return true;
  }
  // `files_persisted` — incremental file write notifications from the SDK.
  if (
    "type" in part &&
    part.type === "system" &&
    (part as { subtype?: string }).subtype === "files_persisted"
  ) {
    const files = (part as { files?: Array<{ filename: string }> }).files ?? [];
    for (const file of files) {
      if (typeof file.filename === "string" && file.filename.length > 0) {
        ctx.emitProgress({ kind: "file", path: file.filename, action: "write" });
        acc.changedFiles.add(file.filename);
      }
    }
    return false;
  }
  return false;
}
