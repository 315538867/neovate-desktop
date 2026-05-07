import { describe, expect, it } from "vitest";

import { parseSSEEvents, StreamAssembler } from "../stream-assembler";

/**
 * StreamAssembler is the per-request reducer that reconstructs an Anthropic
 * Messages API response from SSE events. It is pure logic with no I/O, so we
 * exercise it by feeding hand-crafted event sequences and asserting the
 * `finalize()` shape.
 *
 * Coverage targets:
 *  - message_start populates id/role/model/usage
 *  - text content_block_* assembly accumulates deltas
 *  - tool_use content_block_* parses partial_json into block.input
 *  - tool_use with malformed JSON falls back to the raw string (no data loss)
 *  - message_delta merges stop_reason and usage
 *  - parseSSEEvents skips the [DONE] sentinel and malformed JSON blocks
 */
describe("StreamAssembler", () => {
  it("populates the message envelope from message_start", () => {
    const a = new StreamAssembler();
    a.processEvent({
      type: "message_start",
      message: {
        id: "msg_01",
        type: "message",
        role: "assistant",
        model: "claude-opus-4-6",
        usage: { input_tokens: 12, output_tokens: 0 },
      },
    });
    const out = a.finalize();
    expect(out.id).toBe("msg_01");
    expect(out.role).toBe("assistant");
    expect(out.model).toBe("claude-opus-4-6");
    expect(out.usage).toEqual({ input_tokens: 12, output_tokens: 0 });
    expect(out.content).toEqual([]);
  });

  it("assembles a text block from start + delta + stop", () => {
    const a = new StreamAssembler();
    a.processEvent({ type: "message_start", message: { id: "msg_02" } });
    a.processEvent({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    });
    a.processEvent({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hello, " },
    });
    a.processEvent({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "world!" },
    });
    a.processEvent({ type: "content_block_stop", index: 0 });

    const out = a.finalize();
    expect(out.content).toEqual([{ type: "text", text: "Hello, world!" }]);
  });

  it("parses tool_use partial_json into block.input on stop", () => {
    const a = new StreamAssembler();
    a.processEvent({ type: "message_start", message: { id: "msg_03" } });
    a.processEvent({
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "toolu_01", name: "search" },
    });
    a.processEvent({
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: '{"q":"hello' },
    });
    a.processEvent({
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: ' world"}' },
    });
    a.processEvent({ type: "content_block_stop", index: 0 });

    const out = a.finalize();
    expect(out.content[0]).toMatchObject({
      type: "tool_use",
      id: "toolu_01",
      name: "search",
      input: { q: "hello world" },
    });
  });

  it("falls back to the raw string when tool_use input JSON is malformed", () => {
    const a = new StreamAssembler();
    a.processEvent({ type: "message_start", message: { id: "msg_04" } });
    a.processEvent({
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "toolu_02", name: "search" },
    });
    a.processEvent({
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: "{ not json" },
    });
    a.processEvent({ type: "content_block_stop", index: 0 });

    const out = a.finalize();
    expect(out.content[0].input).toBe("{ not json");
  });

  it("merges stop_reason and usage from message_delta", () => {
    const a = new StreamAssembler();
    a.processEvent({
      type: "message_start",
      message: { id: "msg_05", usage: { input_tokens: 5, output_tokens: 0 } },
    });
    a.processEvent({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 42 },
    });
    a.processEvent({ type: "message_stop" });

    const out = a.finalize();
    expect(out.stop_reason).toBe("end_turn");
    expect(out.usage).toEqual({ input_tokens: 5, output_tokens: 42 });
  });
});

describe("parseSSEEvents", () => {
  it("parses a multi-event stream and skips the [DONE] sentinel", () => {
    const raw =
      `event: message_start\ndata: {"type":"message_start","message":{"id":"x"}}\n\n` +
      `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n` +
      `data: [DONE]\n\n`;

    const events = parseSSEEvents(raw);
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("message_start");
    expect(events[1]?.type).toBe("content_block_delta");
  });

  it("silently drops blocks with malformed JSON without breaking subsequent events", () => {
    const raw =
      `event: garbage\ndata: { not json\n\n` +
      `event: message_stop\ndata: {"type":"message_stop"}\n\n`;

    const events = parseSSEEvents(raw);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("message_stop");
  });
});
