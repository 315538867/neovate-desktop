/**
 * Agent Orchestrator — LLM-only executor.
 *
 * Runs a stage as a single chat-completion against the auxiliary LLM
 * service (no tool use, no Claude Agent SDK). Suitable for cheap
 * "thinking" stages: review, scoring, summarisation, gating logic.
 *
 * Token usage is harvested from the response and forwarded to the
 * BudgetTracker via `ctx.emitProgress({ kind: "tokens", … })`.
 */

import debug from "debug";

import type { ILlmService } from "../../../../shared/features/llm/types";
import type { Executor, ExecutorContext, ExecutorInput, ExecutorResult } from "./types";

const log = debug("neovate:orchestrator:llm-only");

export class LlmOnlyExecutor implements Executor {
  readonly kind = "llm-only" as const;

  constructor(private readonly llm: ILlmService) {}

  async execute(input: ExecutorInput, ctx: ExecutorContext): Promise<ExecutorResult> {
    const { runId, stage, branchIndex, prompt, signal } = input;
    log(
      "execute START runId=%s stage=%s branch=%d promptLen=%d model=%s",
      runId,
      stage.id,
      branchIndex,
      prompt.length,
      stage.model ?? "(default)",
    );

    if (signal.aborted) {
      throw new Error(`[orchestrator] aborted before start (reason=${signal.reason ?? "unknown"})`);
    }

    const abortController = new AbortController();
    const onAbort = () => abortController.abort(signal.reason ?? "external-abort");
    signal.addEventListener("abort", onAbort);

    const start = Date.now();
    try {
      const result = await this.llm.queryMessages([{ role: "user", content: prompt }], {
        model: stage.model,
        signal: abortController.signal,
      });

      ctx.emitProgress({
        kind: "tokens",
        deltaInput: result.usage.inputTokens,
        deltaOutput: result.usage.outputTokens,
      });

      const durationMs = Date.now() - start;
      log(
        "execute DONE runId=%s stage=%s tokensIn=%d tokensOut=%d durMs=%d",
        runId,
        stage.id,
        result.usage.inputTokens,
        result.usage.outputTokens,
        durationMs,
      );

      return {
        output: {
          payload: { content: result.content, model: result.model },
          summary: result.content.slice(0, 1024),
          changedFiles: [],
        },
        usage: {
          usedTokens: result.usage.inputTokens + result.usage.outputTokens,
          usedDurationMs: durationMs,
          usedCostUsd: 0,
          completedStages: 1,
        },
      };
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
}
