import { describe, expect, it } from "vitest";

import { lookupContextWindow, MODEL_CONTEXT_WINDOWS } from "../model-context-windows";

describe("lookupContextWindow", () => {
  it("returns 0 for missing or unknown ids", () => {
    expect(lookupContextWindow()).toBe(0);
    expect(lookupContextWindow("")).toBe(0);
    expect(lookupContextWindow(null)).toBe(0);
    expect(lookupContextWindow("totally-made-up-model-9999")).toBe(0);
  });

  it("matches an exact id", () => {
    expect(lookupContextWindow("deepseek-chat")).toBe(MODEL_CONTEXT_WINDOWS["deepseek-chat"]);
    expect(lookupContextWindow("claude-sonnet-4-6")).toBe(
      MODEL_CONTEXT_WINDOWS["claude-sonnet-4-6"],
    );
  });

  it("falls back through provider prefixes", () => {
    // openrouter ids contain a vendor prefix; tries `vendor/model` first, then `model`
    expect(lookupContextWindow("openrouter/deepseek/deepseek-chat")).toBe(
      MODEL_CONTEXT_WINDOWS["deepseek/deepseek-chat"],
    );
    expect(lookupContextWindow("some-gateway/deepseek-chat")).toBe(
      MODEL_CONTEXT_WINDOWS["deepseek-chat"],
    );
  });

  it("returns 0 when stripping prefixes still yields no match", () => {
    expect(lookupContextWindow("foo/bar/baz")).toBe(0);
  });
});
