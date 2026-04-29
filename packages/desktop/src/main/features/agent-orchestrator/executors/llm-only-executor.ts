import type {
  AgentExecutor,
  ExecutorEvent,
  ExecutorInput,
} from "../../../../shared/features/agent-orchestrator/executor-types";
import type { LlmService } from "../../llm/llm-service";

import { classifyError, isFatalCode, getRetryDelayMs } from "../errors/error-classifier";

export class LlmOnlyExecutor implements AgentExecutor {
  readonly id = "llm-only";
  readonly displayName = "LLM Only";
  readonly capabilities = {
    streaming: true,
    fileTools: false,
    shellTools: false,
    subAgents: false,
    structuredOutput: true,
    maxContextTokens: 200_000,
  };

  constructor(private llmService: LlmService) {}

  async *execute(input: ExecutorInput): AsyncIterable<ExecutorEvent> {
    let cumulativeTokens = 0;
    let attempt = 0;
    const maxRetries = 3;

    while (attempt < maxRetries) {
      try {
        // 构建 prompt
        const messages = [{ role: "user" as const, content: input.userPrompt }];

        const result = await this.llmService.queryMessages(messages, {
          system: input.systemPrompt,
          maxTokens: 4096,
          signal: input.abortSignal,
        });

        cumulativeTokens += result.usage.inputTokens + result.usage.outputTokens;
        yield { type: "usage", tokens: cumulativeTokens, cost: 0 };

        // 尝试解析 JSON（结构化输出变通方案）
        let data: unknown;
        try {
          data = JSON.parse(result.content);
        } catch {
          // 若无法解析 JSON，将原始文本作为输出
          data = { content: result.content };
        }

        yield { type: "structured-output", data };
        yield {
          type: "done",
          summary: { tokensUsed: cumulativeTokens, durationMs: 0 },
        };
        return;
      } catch (err) {
        if (input.abortSignal.aborted) return;

        const classification = classifyError(err);
        const fatal = isFatalCode(classification.code);

        if (fatal) {
          yield {
            type: "error",
            level: "L2",
            code: classification.code,
            message: String(err),
            httpStatus: classification.httpStatus,
          };
          return;
        }

        if (attempt < maxRetries - 1 && classification.level !== "L2") {
          attempt += 1;
          const delay = getRetryDelayMs(attempt);
          yield {
            type: "text",
            delta: `\n[重试 ${attempt}/${maxRetries}，等待 ${delay}ms]`,
          };
          await sleep(delay, input.abortSignal);
          continue;
        }

        yield {
          type: "error",
          level: classification.level,
          code: classification.code,
          message: String(err),
          httpStatus: classification.httpStatus,
        };
        return;
      }
    }
  }

  async cancel(): Promise<void> {
    // abortSignal 触发即可
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, _reject) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
