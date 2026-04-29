/**
 * Redactor — 对 events.jsonl 中的敏感信息（PII）进行脱敏。
 *
 * 脱敏规则:
 * - API Keys (sk-..., ai-..., key-...)
 * - Email addresses
 * - Paths containing home directory
 * - Tokens/JWT
 */
export class Redactor {
  private patterns: Array<{ pattern: RegExp; replacement: string }> = [
    // API Keys
    { pattern: /sk-[a-zA-Z0-9]{20,}/g, replacement: "sk-***REDACTED***" },
    { pattern: /ai-[a-zA-Z0-9]{20,}/g, replacement: "ai-***REDACTED***" },
    { pattern: /key-[a-zA-Z0-9]{20,}/g, replacement: "key-***REDACTED***" },

    // Email
    { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: "***@***.***" },

    // JWT tokens (三段 base64url)
    {
      pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
      replacement: "***JWT_REDACTED***",
    },

    // Home directory paths
    { pattern: /\/Users\/[^/\s]+/g, replacement: "/Users/***" },
    { pattern: /\/home\/[^/\s]+/g, replacement: "/home/***" },
  ];

  /**
   * 脱敏字符串
   */
  redact(input: string): string {
    let result = input;
    for (const { pattern, replacement } of this.patterns) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  /**
   * 脱敏对象（浅层递归，避免循环引用）
   */
  redactObject<T>(obj: T, depth = 3): T {
    if (depth <= 0 || obj == null) return obj;

    if (typeof obj === "string") {
      return this.redact(obj) as unknown as T;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactObject(item, depth - 1)) as unknown as T;
    }

    if (typeof obj === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        result[key] = this.redactObject(value, depth - 1);
      }
      return result as T;
    }

    return obj;
  }
}
