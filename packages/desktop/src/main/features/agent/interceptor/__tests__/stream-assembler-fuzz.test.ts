import { describe, expect, it } from "vitest";

import { StreamAssembler, parseSSEEvents } from "../stream-assembler";

/**
 * Randomized fuzz over StreamAssembler.
 *
 * Real-world SSE streams from Anthropic show wide variance:
 *  - tool_use blocks split partial_json across 2..N delta events at
 *    arbitrary byte boundaries (sometimes mid-key, sometimes mid-value),
 *  - text blocks split across many small text_delta chunks,
 *  - thinking blocks may carry a final signature_delta,
 *  - message_delta carries usage updates that must merge, not replace.
 *
 * The fuzz contract for finalize() is:
 *  - returns an object with an array `content`
 *  - never throws
 *  - if at least one text block was emitted with deltas X1..Xn, the
 *    assembled text equals the concatenation X1..Xn (we verify this via
 *    a side-channel oracle that records what we emitted).
 */

type RngFn = () => number;

function mulberry32(seed: number): RngFn {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickInt(rand: RngFn, min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function randomText(rand: RngFn, len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789 .,!?";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(rand() * chars.length)];
  return out;
}

interface FuzzCase {
  events: Array<{ type: string; [k: string]: any }>;
  oracle: {
    expectedTextByIndex: Record<number, string>;
    expectedToolInputByIndex: Record<number, unknown>;
  };
}

/**
 * Produce a randomized but well-formed event sequence — message_start,
 * 1..3 content blocks (mix of text/tool_use/thinking), message_delta,
 * message_stop. The oracle records the *intended* text/tool input so the
 * test can confirm the assembler reconstructed it exactly.
 */
function makeFuzzCase(rand: RngFn): FuzzCase {
  const events: FuzzCase["events"] = [];
  const oracle: FuzzCase["oracle"] = {
    expectedTextByIndex: {},
    expectedToolInputByIndex: {},
  };

  events.push({
    type: "message_start",
    message: {
      id: `msg_${pickInt(rand, 1000, 9999)}`,
      type: "message",
      role: "assistant",
      model: "claude-opus-4-6",
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: pickInt(rand, 50, 500), output_tokens: 0 },
    },
  });

  const blockCount = pickInt(rand, 1, 3);
  for (let i = 0; i < blockCount; i++) {
    const kind = pickInt(rand, 0, 2);
    if (kind === 0) {
      // text block, fragmented across N text_deltas
      const fullText = randomText(rand, pickInt(rand, 4, 60));
      oracle.expectedTextByIndex[i] = fullText;
      events.push({
        type: "content_block_start",
        index: i,
        content_block: { type: "text", text: "" },
      });
      let cursor = 0;
      while (cursor < fullText.length) {
        const chunk = pickInt(rand, 1, 10);
        events.push({
          type: "content_block_delta",
          index: i,
          delta: { type: "text_delta", text: fullText.slice(cursor, cursor + chunk) },
        });
        cursor += chunk;
      }
      events.push({ type: "content_block_stop", index: i });
    } else if (kind === 1) {
      // tool_use block — fragment a known JSON object across deltas
      const input = {
        query: randomText(rand, pickInt(rand, 3, 12)),
        n: pickInt(rand, 1, 99),
      };
      const json = JSON.stringify(input);
      oracle.expectedToolInputByIndex[i] = input;
      events.push({
        type: "content_block_start",
        index: i,
        content_block: { type: "tool_use", id: `tool_${i}`, name: "search" },
      });
      let cursor = 0;
      while (cursor < json.length) {
        const chunk = pickInt(rand, 1, 5); // small chunks → split mid-key, mid-value
        events.push({
          type: "content_block_delta",
          index: i,
          delta: { type: "input_json_delta", partial_json: json.slice(cursor, cursor + chunk) },
        });
        cursor += chunk;
      }
      events.push({ type: "content_block_stop", index: i });
    } else {
      // thinking block (no oracle assertion — just confirm no crash)
      events.push({
        type: "content_block_start",
        index: i,
        content_block: { type: "thinking", thinking: "" },
      });
      events.push({
        type: "content_block_delta",
        index: i,
        delta: { type: "thinking_delta", thinking: randomText(rand, pickInt(rand, 5, 30)) },
      });
      events.push({
        type: "content_block_delta",
        index: i,
        delta: { type: "signature_delta", signature: "sig-" + pickInt(rand, 1, 99999) },
      });
      events.push({ type: "content_block_stop", index: i });
    }
  }

  events.push({
    type: "message_delta",
    delta: { stop_reason: "end_turn" },
    usage: { output_tokens: pickInt(rand, 10, 500) },
  });
  events.push({ type: "message_stop" });

  return { events, oracle };
}

describe("StreamAssembler — fuzz", () => {
  it("100 randomized streams: finalize() always returns valid shape and reconstructs text/tool_use exactly", () => {
    const SEED = 0xc0ffee;
    const rand = mulberry32(SEED);

    for (let iter = 0; iter < 100; iter++) {
      const fuzz = makeFuzzCase(rand);
      const asm = new StreamAssembler();
      // Must not throw on any sequence
      for (const ev of fuzz.events) {
        expect(() => asm.processEvent(ev)).not.toThrow();
      }
      const result = asm.finalize();

      // Shape invariants
      expect(result).toBeTypeOf("object");
      expect(Array.isArray(result.content)).toBe(true);
      expect(typeof result.id).toBe("string");
      expect(result.role).toBe("assistant");

      // Text blocks: the assembled text must equal the concatenation we recorded
      for (const [idxStr, expectedText] of Object.entries(fuzz.oracle.expectedTextByIndex)) {
        const idx = Number(idxStr);
        const block = result.content[idx];
        expect(block).toBeDefined();
        expect(block.type).toBe("text");
        expect(block.text).toBe(expectedText);
      }

      // tool_use blocks: parsed input must equal the original object
      for (const [idxStr, expectedInput] of Object.entries(fuzz.oracle.expectedToolInputByIndex)) {
        const idx = Number(idxStr);
        const block = result.content[idx];
        expect(block).toBeDefined();
        expect(block.type).toBe("tool_use");
        expect(block.input).toEqual(expectedInput);
      }
    }
  });

  it("survives random garbage events injected mid-stream without throwing", () => {
    const rand = mulberry32(0xdeadbeef);
    const asm = new StreamAssembler();
    asm.processEvent({
      type: "message_start",
      message: { id: "m1", role: "assistant", model: "claude-opus-4-6" },
    });
    // 50 random events — many will be unknown types, missing fields, etc.
    for (let i = 0; i < 50; i++) {
      const garbage: any = {
        type: ["unknown", "content_block_delta", "message_delta", "weird"][pickInt(rand, 0, 3)],
        index: pickInt(rand, -5, 10),
      };
      // Sometimes attach a malformed delta
      if (rand() < 0.5) {
        garbage.delta = { type: "text_delta", text: rand() < 0.3 ? null : randomText(rand, 5) };
      }
      expect(() => asm.processEvent(garbage)).not.toThrow();
    }
    const result = asm.finalize();
    expect(result).toBeTypeOf("object");
    expect(Array.isArray(result.content)).toBe(true);
  });

  it("parseSSEEvents survives fuzz of malformed and well-formed blocks mixed", () => {
    const rand = mulberry32(0xfeedface);
    const blocks: string[] = [];
    for (let i = 0; i < 50; i++) {
      const dice = rand();
      if (dice < 0.3) {
        // Well-formed
        blocks.push(
          `event: message_delta\ndata: ${JSON.stringify({
            type: "message_delta",
            delta: { stop_reason: "end_turn" },
            usage: { output_tokens: pickInt(rand, 1, 200) },
          })}`,
        );
      } else if (dice < 0.5) {
        // [DONE] sentinel
        blocks.push("data: [DONE]");
      } else if (dice < 0.7) {
        // Malformed JSON
        blocks.push("event: message_delta\ndata: { not json");
      } else if (dice < 0.85) {
        // Empty block
        blocks.push("");
      } else {
        // No data line
        blocks.push("event: only_event");
      }
    }
    const raw = blocks.join("\n\n");
    expect(() => parseSSEEvents(raw)).not.toThrow();
    const events = parseSSEEvents(raw);
    // All emitted events must have a string `type` field
    for (const ev of events) {
      expect(typeof ev.type).toBe("string");
    }
  });
});
