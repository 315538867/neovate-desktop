import { describe, expect, it } from "vitest";

import type { ClaudeCodeUIMessage } from "../types";

import { extractReadableUserText } from "../extract-readable-user-text";

type Parts = ClaudeCodeUIMessage["parts"];

const text = (s: string) => ({ type: "text", text: s, state: "done" }) as Parts[number];
const cmd = (data: { name: string; args?: string; stdout?: string }) =>
  ({ type: "data-slash-command", data }) as Parts[number];

describe("extractReadableUserText", () => {
  it("returns empty for missing or empty parts", () => {
    expect(extractReadableUserText(undefined)).toBe("");
    expect(extractReadableUserText([])).toBe("");
  });

  it("emits text parts verbatim", () => {
    expect(extractReadableUserText([text("hello"), text(" world")])).toBe("hello world");
  });

  it("renders slash command as /name args", () => {
    expect(extractReadableUserText([cmd({ name: "model", args: "claude-4.7-opus" })])).toBe(
      "/model claude-4.7-opus",
    );
  });

  it("renders slash command without args as bare /name", () => {
    expect(extractReadableUserText([cmd({ name: "compact" })])).toBe("/compact");
  });

  it("omits side-effect fields", () => {
    // stdout is CLI output; not part of what the user typed.
    expect(extractReadableUserText([cmd({ name: "model", args: "x", stdout: "ok" })])).toBe(
      "/model x",
    );
  });

  it("skips parts whose name is empty", () => {
    expect(extractReadableUserText([cmd({ name: "" }), text("ok")])).toBe("ok");
  });

  it("interleaves text and slash commands in order", () => {
    expect(
      extractReadableUserText([text("first "), cmd({ name: "compact" }), text(" then more")], ""),
    ).toBe("first /compact then more");
  });

  it("respects custom joiner", () => {
    expect(extractReadableUserText([cmd({ name: "a" }), cmd({ name: "b", args: "x" })], "\n")).toBe(
      "/a\n/b x",
    );
  });

  it("ignores unrelated part types (file, reasoning)", () => {
    const parts = [
      { type: "file", url: "data:image/png;base64,AA", mediaType: "image/png" } as Parts[number],
      { type: "reasoning", text: "private", state: "done" } as Parts[number],
      text("visible"),
    ];
    expect(extractReadableUserText(parts)).toBe("visible");
  });
});
