export interface ClassifiedError {
  level: "L0" | "L1" | "L2";
  code: string;
  httpStatus?: number;
}

export function classifyError(err: unknown): ClassifiedError {
  // L0: 网络层
  if (err instanceof Error) {
    if (
      err.message.includes("ECONNRESET") ||
      err.message.includes("ETIMEDOUT") ||
      err.message.includes("ENOTFOUND") ||
      err.message.includes("ECONNREFUSED")
    ) {
      return { level: "L0", code: "network_failed" };
    }

    // L2: 鉴权/请求错误
    if (err.message.includes("401") || err.message.includes("Unauthorized")) {
      return { level: "L2", code: "auth_failed", httpStatus: 401 };
    }
    if (err.message.includes("400") || err.message.includes("Bad Request")) {
      return { level: "L2", code: "invalid_request", httpStatus: 400 };
    }
    if (err.message.includes("403")) {
      return { level: "L2", code: "content_policy", httpStatus: 403 };
    }

    // L1: 限流
    if (err.message.includes("429") || err.message.includes("rate")) {
      return { level: "L1", code: "rate_limit_exhausted", httpStatus: 429 };
    }

    // L1: 服务端错误
    if (
      err.message.includes("500") ||
      err.message.includes("502") ||
      err.message.includes("503") ||
      err.message.includes("Server Error")
    ) {
      return { level: "L1", code: "unknown" };
    }

    // L2: Context 超限
    if (/context.*(length|too.*long|limit)/i.test(err.message)) {
      return { level: "L2", code: "context_too_long" };
    }

    // L2: 超时
    if (err.message.includes("timeout") || err.message.includes("timed out")) {
      return { level: "L1", code: "timeout" };
    }
  }

  // 未知错误默认 L1
  return { level: "L1", code: "unknown" };
}

export function isFatalCode(code: string): boolean {
  return [
    "auth_failed",
    "invalid_request",
    "context_too_long",
    "content_policy",
    "capability_mismatch",
  ].includes(code);
}

export function isRetryable(classified: ClassifiedError): boolean {
  return classified.level === "L0" || classified.level === "L1";
}

export function getRetryDelayMs(attempt: number): number {
  return Math.min(1000 * Math.pow(3, attempt), 30_000);
}
