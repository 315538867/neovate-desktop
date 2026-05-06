/**
 * Agent Orchestrator — Sensitive value redaction.
 *
 * Stage prompts and trace events frequently echo user input back into
 * persisted logs. Before that text reaches the EventStore (and from
 * there the renderer trace pane), we run it through a small set of
 * pattern-based scrubbers that mask common credential shapes.
 *
 * The patterns are intentionally conservative. False negatives are
 * preferable to false positives since callers can layer additional
 * patterns on top via the `extraPatterns` option.
 *
 * The list mirrors `features/agent/interceptor/credential-mask.ts` so
 * orchestrator traces stay consistent with chat traffic redaction —
 * but kept independent because the orchestrator may run before the
 * agent module is initialised (eg. crash recovery).
 */

const REDACTED = "[REDACTED]";

/**
 * Default credential patterns.
 *
 * - `sk-...` Anthropic / OpenAI API keys
 * - `ghp_` / `gho_` / `ghs_` / `ghu_` GitHub PATs
 * - `AKIA...` AWS access keys
 * - `aws_secret_access_key=` line in env files
 * - `Bearer <jwt>` Authorization headers
 * - `eyJ...` JWT tokens
 */
const DEFAULT_PATTERNS: ReadonlyArray<RegExp> = [
  /sk-(?:ant-)?[A-Za-z0-9_-]{20,}/g,
  /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /(aws_secret_access_key\s*=\s*)([A-Za-z0-9/+=]{30,})/gi,
  /(Authorization:\s*Bearer\s+)([A-Za-z0-9._\-+/=]{20,})/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_.+/=-]{10,}\b/g,
];

export type RedactionOptions = {
  /** Additional regexes (with `g` flag) to apply after defaults. */
  extraPatterns?: ReadonlyArray<RegExp>;
  /** Override the default patterns entirely. */
  patterns?: ReadonlyArray<RegExp>;
  /** String inserted in place of matches. */
  placeholder?: string;
};

/** Redact a string. Returns the original reference if no pattern matched. */
export function redactSensitive(text: string, options: RedactionOptions = {}): string {
  if (!text) return text;
  const patterns = options.patterns ?? DEFAULT_PATTERNS;
  const extra = options.extraPatterns ?? [];
  const placeholder = options.placeholder ?? REDACTED;
  let result = text;
  for (const pattern of [...patterns, ...extra]) {
    result = result.replace(pattern, (_match: string, ...groups: unknown[]) => {
      // If the regex captured a key/prefix in group 1 we keep it and
      // mask only the secret portion. Otherwise replace the whole match.
      const possiblePrefix = groups.length > 2 && typeof groups[0] === "string" ? groups[0] : null;
      if (possiblePrefix !== null) return `${possiblePrefix}${placeholder}`;
      return placeholder;
    });
  }
  return result;
}

/** Recursively redact strings inside a JSON-friendly structure. */
export function redactValue<T>(value: T, options: RedactionOptions = {}): T {
  if (typeof value === "string") return redactSensitive(value, options) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, options)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(v, options);
    }
    return out as unknown as T;
  }
  return value;
}
