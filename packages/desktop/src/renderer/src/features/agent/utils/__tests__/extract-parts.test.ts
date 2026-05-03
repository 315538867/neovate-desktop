import { describe, expect, it } from "vitest";

import { extractParts } from "../extract-parts";

describe("extractParts", () => {
  it("returns plain text part when no slash command is present", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "hello world" }],
        },
      ],
    };
    const result = extractParts(doc);
    expect(result.text).toBe("hello world");
    expect(result.parts).toEqual([{ type: "text", text: "hello world", state: "done" }]);
  });

  it("emits a data-slash-command part for a slashCommand node", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "slashCommand", attrs: { label: "/model" } },
            { type: "text", text: " " },
          ],
        },
      ],
    };
    const result = extractParts(doc);
    expect(result.parts).toEqual([{ type: "data-slash-command", data: { name: "model" } }]);
    expect(result.text).toBe("/model");
  });

  it("preserves slash + args mix as separate parts", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "slashCommand", attrs: { label: "/model" } },
            { type: "text", text: " claude-4.7-opus" },
          ],
        },
      ],
    };
    const result = extractParts(doc);
    expect(result.parts).toEqual([
      { type: "data-slash-command", data: { name: "model" } },
      { type: "text", text: " claude-4.7-opus", state: "done" },
    ]);
    expect(result.text).toBe("/model claude-4.7-opus");
  });

  it("flushes text accumulated before a slash command", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "before " },
            { type: "slashCommand", attrs: { label: "/help" } },
            { type: "text", text: " after" },
          ],
        },
      ],
    };
    const result = extractParts(doc);
    expect(result.parts).toEqual([
      { type: "text", text: "before ", state: "done" },
      { type: "data-slash-command", data: { name: "help" } },
      { type: "text", text: " after", state: "done" },
    ]);
  });

  it("strips multiple leading slashes from the label defensively", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "slashCommand", attrs: { label: "//compact" } }],
        },
      ],
    };
    const result = extractParts(doc);
    expect(result.parts).toEqual([{ type: "data-slash-command", data: { name: "compact" } }]);
  });

  it("ignores slashCommand nodes with empty labels", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "hello" },
            { type: "slashCommand", attrs: { label: "" } },
          ],
        },
      ],
    };
    const result = extractParts(doc);
    expect(result.parts).toEqual([{ type: "text", text: "hello", state: "done" }]);
  });

  it("trims whitespace at the document edges", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "slashCommand", attrs: { label: "/clear" } },
            { type: "text", text: " " },
          ],
        },
      ],
    };
    const result = extractParts(doc);
    expect(result.parts).toEqual([{ type: "data-slash-command", data: { name: "clear" } }]);
    expect(result.text).toBe("/clear");
  });

  it("expands mention nodes the same way extractText does", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "mention", attrs: { id: "src/foo.ts", label: "src/foo.ts" } },
            { type: "text", text: " please review" },
          ],
        },
      ],
    };
    const result = extractParts(doc);
    expect(result.text).toBe("@src/foo.ts please review");
  });
});
