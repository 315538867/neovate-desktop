/**
 * Best-effort credential redaction for the fetch interceptor.
 *
 * The interceptor emits request/response telemetry to the parent process
 * for the inspector UI. This module ensures sensitive material — API
 * keys, bearer tokens, cookies — never lands in those payloads (and
 * therefore never appears on disk in inspector logs / persisted state).
 *
 * Scope is intentionally pragmatic, not cryptographic:
 *   - We mask known high-risk header names regardless of value shape.
 *   - We mask values that LOOK like credentials (sk-…, AIza…, JWT, long
 *     opaque tokens) wherever they appear in URL query strings or bodies.
 *
 * False positives in body masking are acceptable; false negatives are
 * what we're trying to prevent.
 */

const SENSITIVE_HEADERS = new Set([
  // Anthropic / OpenAI / generic
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "x-auth-token",
  // Google
  "x-goog-api-key",
  // Cookies (often carry session tokens)
  "cookie",
  "set-cookie",
  // Custom proxy / org identifiers we still don't want to leak
  "openai-organization",
  "x-organization",
]);

const SENSITIVE_QUERY_PARAMS = new Set([
  "key",
  "api_key",
  "apikey",
  "access_token",
  "token",
  "auth",
  "password",
]);

// Patterns that look like credentials anywhere in a string.
// Each pattern is anchored by a recognizable prefix to keep false
// positives low; long opaque tokens without a prefix are not matched.
const CREDENTIAL_PATTERNS: ReadonlyArray<RegExp> = [
  // Anthropic/OpenAI-style: sk-… (≥ 20 chars after prefix)
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  // Google API keys
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  // GitHub PATs / fine-grained tokens
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  // JWTs (three base64url segments)
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
];

/**
 * Mask an API key or token, keeping a recognizable prefix and the last
 * 3 chars so a developer can still match it against their own records.
 *
 * Examples:
 *   "sk-ant-api03-abcdef…xyz"    → "sk-ant****xyz"
 *   "Bearer sk-ant-api03-abc…"   → "Bearer sk-ant****xyz"
 *   "AIzaSyA…xyz"                → "AIzaSy****xyz"
 *   anything else (≥ 12 chars)   → first 4 + **** + last 3
 *   short value                  → "****"
 */
export function maskCredential(value: string): string {
  if (!value) return value;

  if (value.startsWith("Bearer ")) {
    return `Bearer ${maskCredential(value.slice(7))}`;
  }

  if (value.length < 12) {
    return "****";
  }

  if (value.startsWith("sk-")) {
    return `${value.slice(0, 6)}****${value.slice(-3)}`;
  }
  if (value.startsWith("AIza")) {
    return `${value.slice(0, 6)}****${value.slice(-3)}`;
  }

  return `${value.slice(0, 4)}****${value.slice(-3)}`;
}

/**
 * Return a copy of the headers with sensitive values masked.
 */
export function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [key, val] of Object.entries(headers)) {
    masked[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? maskCredential(val) : val;
  }
  return masked;
}

/**
 * Strip credentials embedded in URL query strings (e.g. `?api_key=…`).
 * Returns the URL unchanged if it cannot be parsed.
 */
export function maskUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return maskCredentialsInString(url);
  }
  let mutated = false;
  for (const [key, value] of parsed.searchParams) {
    if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
      parsed.searchParams.set(key, maskCredential(value));
      mutated = true;
    }
  }
  return mutated ? parsed.toString() : url;
}

/**
 * Mask credential-shaped substrings anywhere in `text`. Used as a
 * last-line defense for raw request/response bodies.
 */
export function maskCredentialsInString(text: string): string {
  let out = text;
  for (const pattern of CREDENTIAL_PATTERNS) {
    out = out.replace(pattern, (match) => maskCredential(match));
  }
  return out;
}

/**
 * Mask credentials in a JSON-shaped value. Strings are scanned for
 * credential patterns; objects/arrays are walked recursively. Keys whose
 * name looks sensitive (`api_key`, `password`, `authorization`, …) have
 * their entire string value masked, irrespective of pattern.
 */
export function maskCredentialsInValue<T>(value: T): T {
  return walk(value) as T;
}

const SENSITIVE_KEY_HINTS = [
  "apikey",
  "api_key",
  "accesstoken",
  "access_token",
  "authtoken",
  "auth_token",
  "authorization",
  "password",
  "secret",
  "token",
];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_HINTS.some((hint) => lower === hint || lower.endsWith(hint));
}

function walk(value: unknown): unknown {
  if (typeof value === "string") {
    return maskCredentialsInString(value);
  }
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(walk);

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string" && isSensitiveKey(k)) {
      out[k] = maskCredential(v);
    } else {
      out[k] = walk(v);
    }
  }
  return out;
}
