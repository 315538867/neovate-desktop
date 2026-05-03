import { describe, expect, it } from "vitest";

import { parseCliUserContent } from "../parse-cli-user-content";

describe("parseCliUserContent", () => {
  describe("plain inputs", () => {
    it("returns no parts for empty string", () => {
      expect(parseCliUserContent("").parts).toEqual([]);
    });

    it("returns no parts for non-string non-array", () => {
      expect(parseCliUserContent(null).parts).toEqual([]);
      expect(parseCliUserContent(123).parts).toEqual([]);
    });

    it("returns a single text part for plain prose", () => {
      expect(parseCliUserContent("hello world").parts).toEqual([
        { type: "text", text: "hello world", state: "done" },
      ]);
    });

    it("does not touch unrelated angle-bracket text", () => {
      const text = "use `Array<number>` not `<any>`";
      expect(parseCliUserContent(text).parts).toEqual([{ type: "text", text, state: "done" }]);
    });
  });

  describe("single slash-command envelope", () => {
    it("extracts command name without leading slash", () => {
      const text = "<command-name>/model</command-name>";
      expect(parseCliUserContent(text).parts).toEqual([
        { type: "data-slash-command", data: { name: "model" } },
      ]);
    });

    it("extracts adjacent message/args/stdout/caveat", () => {
      const text =
        "<command-name>/model</command-name>" +
        "<command-message>model</command-message>" +
        "<command-args>claude-4.7-opus</command-args>" +
        "<local-command-stdout>Set model to claude-4.7-opus</local-command-stdout>" +
        "<local-command-caveat>be careful</local-command-caveat>";
      expect(parseCliUserContent(text).parts).toEqual([
        {
          type: "data-slash-command",
          data: {
            name: "model",
            message: "model",
            args: "claude-4.7-opus",
            stdout: "Set model to claude-4.7-opus",
            caveat: "be careful",
          },
        },
      ]);
    });

    it("tolerates whitespace and newlines between adjacent tags", () => {
      const text =
        "<command-name>/model</command-name>\n" + "  <command-args>claude-4.7-opus</command-args>";
      expect(parseCliUserContent(text).parts).toEqual([
        {
          type: "data-slash-command",
          data: { name: "model", args: "claude-4.7-opus" },
        },
      ]);
    });

    it("tolerates tags arriving in unusual order", () => {
      const text =
        "<command-name>/foo</command-name>" +
        "<command-args>x</command-args>" +
        "<command-message>foo</command-message>";
      expect(parseCliUserContent(text).parts).toEqual([
        {
          type: "data-slash-command",
          data: { name: "foo", args: "x", message: "foo" },
        },
      ]);
    });
  });

  describe("real-world sample (two consecutive commands with free text)", () => {
    it("absorbs args→stdout free text as extraText and surfaces stdout on the first block", () => {
      const text =
        "<command-name>/model</command-name>\n" +
        "<command-message>model</command-message>\n" +
        "<command-args>claude-4.7-opus</command-args>" +
        "回退到此处" +
        "<local-command-stdout>Set model to claude-4.7-opus</local-command-stdout>" +
        "回退到此处" +
        "<command-message>zcf:workflow</command-message>" +
        "<command-name>/zcf:workflow</command-name>" +
        "<command-args> 后续参数</command-args>";

      const parts = parseCliUserContent(text).parts;
      expect(parts).toHaveLength(3);
      expect(parts[0]).toEqual({
        type: "data-slash-command",
        data: {
          name: "model",
          message: "model",
          args: "claude-4.7-opus",
          stdout: "Set model to claude-4.7-opus",
          extraText: "回退到此处",
        },
      });
      // Inter-block free text "回退到此处" survives. The pre-anchor
      // `<command-message>zcf:workflow</command-message>` is absorbed into
      // the next block (Phase A0), not left as orphan text.
      expect(parts[1]).toEqual({
        type: "text",
        text: "回退到此处",
        state: "done",
      });
      expect(parts[2]).toEqual({
        type: "data-slash-command",
        data: { name: "zcf:workflow", message: "zcf:workflow", args: "后续参数" },
      });
    });
  });

  describe("pre-anchor <command-message> lookback (real CLI emission order)", () => {
    it("absorbs <command-message> that the CLI emits before <command-name>", () => {
      // This is the actual order Claude Code CLI uses in jsonl persistence.
      const text =
        "<command-message>zcf:workflow</command-message>\n" +
        "<command-name>/zcf:workflow</command-name>\n" +
        "<command-args> 用斜杆命令 在输入时会有特殊的样式</command-args>";
      expect(parseCliUserContent(text).parts).toEqual([
        {
          type: "data-slash-command",
          data: {
            name: "zcf:workflow",
            message: "zcf:workflow",
            args: "用斜杆命令 在输入时会有特殊的样式",
          },
        },
      ]);
    });

    it("does not absorb <command-message> separated from <command-name> by other content", () => {
      // Lookback requires the closing tag to sit immediately on the left of
      // <command-name>, with only whitespace in between. Prose between them
      // means the message is unrelated and must remain orphan-stripped text.
      const text =
        "<command-message>foo</command-message>some prose<command-name>/bar</command-name>";
      const parts = parseCliUserContent(text).parts;
      expect(parts).toEqual([
        { type: "text", text: "foosome prose", state: "done" },
        { type: "data-slash-command", data: { name: "bar" } },
      ]);
    });
  });

  describe("malformed input", () => {
    it("treats missing close tag as plain text and strips inner orphan tags", () => {
      const text = "<command-name>/model<command-args>x</command-args>";
      // The unclosed `<command-name>` is not stripped (stripper requires both
      // opening and closing tag), but the inner `<command-args>` envelope is
      // removed since it's orphaned — the user-meaningful args value remains.
      expect(parseCliUserContent(text).parts).toEqual([
        { type: "text", text: "<command-name>/modelx", state: "done" },
      ]);
    });

    it("treats empty command-name payload as nothing renderable", () => {
      const text = "<command-name></command-name>";
      // No anchor (empty payload) → orphan stripper drops the wrapper and
      // leaves the empty inner string, so no parts are produced.
      expect(parseCliUserContent(text).parts).toEqual([]);
    });

    it("does not match across other anchor tags as a single block", () => {
      // Two separate command-name blocks with text between them yields two
      // domain events plus an interstitial text part for the prose between
      // them. Without a side-effect tag (`<local-command-*>`) the prose is
      // not absorbed into the first block.
      const text = "<command-name>/a</command-name>middle<command-name>/b</command-name>";
      expect(parseCliUserContent(text).parts).toEqual([
        { type: "data-slash-command", data: { name: "a" } },
        { type: "text", text: "middle", state: "done" },
        { type: "data-slash-command", data: { name: "b" } },
      ]);
    });
  });

  describe("bare slash-command (user-level command, no XML envelope)", () => {
    it("recognizes a bare slash command at start of string with args", () => {
      const text = "/zcf:workflow 你好";
      expect(parseCliUserContent(text).parts).toEqual([
        {
          type: "data-slash-command",
          data: { name: "zcf:workflow", args: "你好" },
        },
      ]);
    });

    it("recognizes a bare slash command without args", () => {
      const text = "/zcf:workflow";
      expect(parseCliUserContent(text).parts).toEqual([
        { type: "data-slash-command", data: { name: "zcf:workflow" } },
      ]);
    });

    it("supports kebab-case command names", () => {
      const text = "/zcf-workflow do something";
      expect(parseCliUserContent(text).parts).toEqual([
        {
          type: "data-slash-command",
          data: { name: "zcf-workflow", args: "do something" },
        },
      ]);
    });

    it("splits a bare command followed by a newline into command + text", () => {
      const text = "/foo\n第二段";
      expect(parseCliUserContent(text).parts).toEqual([
        { type: "data-slash-command", data: { name: "foo" } },
        { type: "text", text: "\n第二段", state: "done" },
      ]);
    });

    it("does not falsely match a unix-style path", () => {
      const text = "/path/to/file 内容";
      expect(parseCliUserContent(text).parts).toEqual([{ type: "text", text, state: "done" }]);
    });

    it("does not match when slash is not at line start", () => {
      const text = "前缀 /foo";
      expect(parseCliUserContent(text).parts).toEqual([{ type: "text", text, state: "done" }]);
    });

    it("matches a bare command on a subsequent line", () => {
      const text = "前面正文\n/zcf:workflow 你好";
      expect(parseCliUserContent(text).parts).toEqual([
        { type: "text", text: "前面正文\n", state: "done" },
        {
          type: "data-slash-command",
          data: { name: "zcf:workflow", args: "你好" },
        },
      ]);
    });

    it("does not match a command starting with a digit", () => {
      const text = "/123foo bar";
      expect(parseCliUserContent(text).parts).toEqual([{ type: "text", text, state: "done" }]);
    });

    it("XML envelope still wins when both formats are present at the same start", () => {
      const text = "<command-name>/model</command-name>";
      expect(parseCliUserContent(text).parts).toEqual([
        { type: "data-slash-command", data: { name: "model" } },
      ]);
    });
  });

  describe("array content with images", () => {
    it("preserves text and image parts in order", () => {
      const result = parseCliUserContent([
        { type: "text", text: "hello " },
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "AAA" },
        },
        { type: "text", text: "<command-name>/model</command-name>" },
      ]);
      expect(result.parts).toEqual([
        { type: "text", text: "hello ", state: "done" },
        { type: "file", mediaType: "image/png", url: "data:image/png;base64,AAA" },
        { type: "data-slash-command", data: { name: "model" } },
      ]);
    });

    it("handles missing image source gracefully", () => {
      const result = parseCliUserContent([{ type: "text", text: "x" }, { type: "image" }]);
      expect(result.parts).toEqual([{ type: "text", text: "x", state: "done" }]);
    });

    it("returns empty parts for empty array", () => {
      expect(parseCliUserContent([]).parts).toEqual([]);
    });
  });
});
