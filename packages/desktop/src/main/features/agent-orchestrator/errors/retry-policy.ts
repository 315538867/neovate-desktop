import type { StageError } from "../../../../shared/features/agent-orchestrator/schemas";

import { classifyError, getRetryDelayMs, isFatalCode } from "./error-classifier";

export interface RetryDecision {
  shouldRetry: boolean;
  delayMs: number;
  reason: string;
}

/**
 * RetryPolicy — 统一的 stage 重试策略。
 * 集成 error-classifier 并添加 stage 维度的策略。
 */
export class RetryPolicy {
  private maxRetries = 3;

  /**
   * 评估是否应重试失败的 stage
   */
  evaluate(attempt: number, error: StageError): RetryDecision {
    if (attempt >= this.maxRetries) {
      return { shouldRetry: false, delayMs: 0, reason: "Max retries reached" };
    }

    if (isFatalCode(error.code)) {
      return { shouldRetry: false, delayMs: 0, reason: `Fatal error: ${error.code}` };
    }

    if (error.level === "L2") {
      return { shouldRetry: false, delayMs: 0, reason: `L2 error: ${error.code}` };
    }

    // L0/L1 可重试
    const delayMs = getRetryDelayMs(attempt);
    return { shouldRetry: true, delayMs, reason: `Retryable: ${error.code}` };
  }

  /**
   * 对原始 Error 对象评估重试
   */
  evaluateRaw(attempt: number, err: unknown): RetryDecision {
    const classified = classifyError(err);
    return this.evaluate(attempt, {
      attempt,
      timestamp: new Date().toISOString(),
      level: classified.level,
      code: classified.code as StageError["code"],
      httpStatus: classified.httpStatus,
      providerMessage: String(err),
    });
  }
}
