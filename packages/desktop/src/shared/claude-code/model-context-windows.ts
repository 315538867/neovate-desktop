/**
 * Static contextWindow lookup for known models, used as a fallback when
 * the Claude Agent SDK does not report `modelUsage[*].contextWindow`
 * (common for non-Anthropic providers proxied via OpenAI-compatible APIs).
 */

const K = 1000;

export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic (SDK normally reports these; included for completeness)
  "claude-opus-4-6": 200 * K,
  "claude-sonnet-4-6": 200 * K,
  "claude-haiku-4-5": 200 * K,
  "claude-opus-4-7": 200 * K,
  "claude-sonnet-4-6-20250929": 200 * K,

  // OpenRouter (provider-prefixed ids)
  "anthropic/claude-opus-4.6": 200 * K,
  "anthropic/claude-sonnet-4.6": 200 * K,
  "anthropic/claude-haiku-4.5": 200 * K,
  "google/gemini-3-pro-preview": 1000 * K,
  "google/gemini-3-flash-preview": 1000 * K,
  "z-ai/glm-5": 128 * K,
  "deepseek/deepseek-reasoner": 128 * K,
  "deepseek/deepseek-chat": 128 * K,
  "moonshotai/kimi-k2.5": 200 * K,
  "minimax/minimax-m2.5": 200 * K,

  // Direct provider ids
  "deepseek-chat": 128 * K,
  "deepseek-reasoner": 128 * K,
  "glm-4.6": 128 * K,
  "glm-4-plus": 128 * K,
  "glm-5": 128 * K,
  "kimi-k2": 200 * K,
  "kimi-k2.5": 200 * K,
  "moonshot-v1-128k": 128 * K,
  "qwen-max": 128 * K,
  "qwen-plus": 128 * K,
  "qwen3-coder": 256 * K,
  "gpt-4o": 128 * K,
  "gpt-4.1": 1000 * K,
  "gemini-3-pro": 1000 * K,
  "gemini-3-flash": 1000 * K,
};

/**
 * Look up the context window size (in tokens) for a given model id.
 * Tries the exact id, then progressively strips one provider prefix
 * (e.g. `openrouter/anthropic/claude-...` → `anthropic/claude-...`).
 * Returns 0 when no match is found, so callers can decide on a fallback UI.
 */
export function lookupContextWindow(modelId?: string | null): number {
  if (!modelId) return 0;
  if (MODEL_CONTEXT_WINDOWS[modelId]) return MODEL_CONTEXT_WINDOWS[modelId];

  let id = modelId;
  while (id.includes("/")) {
    id = id.slice(id.indexOf("/") + 1);
    if (MODEL_CONTEXT_WINDOWS[id]) return MODEL_CONTEXT_WINDOWS[id];
  }
  return 0;
}
