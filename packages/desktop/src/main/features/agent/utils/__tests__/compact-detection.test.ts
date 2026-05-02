import { describe, expect, it } from "vitest";

import {
  COMPACT_SUMMARY_PREFIX,
  extractTextFromUserContent,
  isCompactSummaryText,
} from "../compact-detection";

describe("isCompactSummaryText", () => {
  it("returns true for canonical compact-summary text", () => {
    expect(
      isCompactSummaryText(
        `${COMPACT_SUMMARY_PREFIX} The summary below covers the earlier portion of the conversation.`,
      ),
    ).toBe(true);
  });

  it("tolerates leading whitespace/newlines", () => {
    expect(isCompactSummaryText(`  \n${COMPACT_SUMMARY_PREFIX} ...`)).toBe(true);
  });

  it("is case-sensitive (returns false for lower-case prefix)", () => {
    expect(isCompactSummaryText(COMPACT_SUMMARY_PREFIX.toLowerCase())).toBe(false);
  });

  it("returns false for unrelated user text", () => {
    expect(isCompactSummaryText("hello, please continue from before")).toBe(false);
  });

  it("returns false for empty / non-string input", () => {
    expect(isCompactSummaryText("")).toBe(false);
    expect(isCompactSummaryText(undefined as unknown as string)).toBe(false);
    expect(isCompactSummaryText(null as unknown as string)).toBe(false);
  });
});

describe("extractTextFromUserContent", () => {
  it("returns the string unchanged when content is a string", () => {
    expect(extractTextFromUserContent("hello")).toBe("hello");
  });

  it("concatenates text blocks from an array, ignoring non-text blocks", () => {
    const content = [
      { type: "text", text: "foo " },
      { type: "image", source: {} },
      { type: "text", text: "bar" },
    ];
    expect(extractTextFromUserContent(content)).toBe("foo bar");
  });

  it("returns empty string for unknown content shapes", () => {
    expect(extractTextFromUserContent(undefined)).toBe("");
    expect(extractTextFromUserContent(null)).toBe("");
    expect(extractTextFromUserContent({ foo: "bar" })).toBe("");
  });

  it("recognizes summary text wrapped in array content", () => {
    const text = extractTextFromUserContent([
      { type: "text", text: `${COMPACT_SUMMARY_PREFIX} ...` },
    ]);
    expect(isCompactSummaryText(text)).toBe(true);
  });
});
