import { describe, expect, it } from "vitest";

import { parseCompactSummary } from "../parse-compact-summary";

const CANONICAL = `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

Summary:
1. Primary Request and Intent:
   The user requested designing a multi-agent collaboration system.
   They iterated on the architecture multiple times.

2. Key Technical Concepts:
   - Fan-out / Fan-in pipelines
   - Budget control
   - Checkpointing

3. Files and Code Sections:
   - src/main/orchestrator/index.ts: pipeline entry
   - src/shared/types.ts: schema additions

4. Errors and fixes:
   None during this segment.
`;

describe("parseCompactSummary", () => {
  it("parses canonical Claude Code summary into intro + sections", () => {
    const parsed = parseCompactSummary(CANONICAL);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.intro).toMatch(/This session is being continued/);
    expect(parsed.sections).toHaveLength(4);

    expect(parsed.sections[0]).toMatchObject({
      index: 1,
      title: "Primary Request and Intent",
    });
    expect(parsed.sections[0].body).toMatch(/multi-agent collaboration system/);

    expect(parsed.sections[2].title).toBe("Files and Code Sections");
    expect(parsed.sections[2].body).toMatch(/src\/main\/orchestrator\/index\.ts/);

    expect(parsed.sections[3].title).toBe("Errors and fixes");
  });

  it("returns ok:false when 'Summary:' header is missing", () => {
    const parsed = parseCompactSummary("Some random text without the marker.");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.raw).toBe("Some random text without the marker.");
  });

  it("returns ok:false on empty string", () => {
    const parsed = parseCompactSummary("");
    expect(parsed.ok).toBe(false);
  });

  it("returns ok:false when Summary header exists but no numbered sections follow", () => {
    const parsed = parseCompactSummary("intro\n\nSummary:\n\nfree-form text without numbering.");
    expect(parsed.ok).toBe(false);
  });

  it("preserves out-of-order section indices in source order", () => {
    const text = `Summary:
3. Third:
   body3
1. First:
   body1
`;
    const parsed = parseCompactSummary(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.sections.map((s) => s.index)).toEqual([3, 1]);
  });

  it("returns ok:false for non-string input", () => {
    // @ts-expect-error intentional bad input for runtime guard
    const parsed = parseCompactSummary(undefined);
    expect(parsed.ok).toBe(false);
  });
});
