/**
 * Parse Claude Code's auto-generated compact summary text into structured
 * sections. The standard format produced by the SDK looks like:
 *
 *   This session is being continued from a previous conversation that ran
 *   out of context. The summary below covers the earlier portion of the
 *   conversation.
 *
 *   Summary:
 *   1. Primary Request and Intent:
 *      ...body...
 *   2. Key Technical Concepts:
 *      ...body...
 *   3. Files and Code Sections:
 *      ...body...
 *
 * Returns `{ ok: true, intro, sections }` on success, or `{ ok: false, raw }`
 * for graceful fallback when the format doesn't match.
 */

export type CompactSummarySection = {
  /** The numeric index as it appears in the source ("1", "2", ...). */
  index: number;
  /** Section title without the trailing colon, trimmed. */
  title: string;
  /** Raw markdown body of the section (already de-indented). */
  body: string;
};

export type ParsedCompactSummary =
  | {
      ok: true;
      intro: string;
      sections: CompactSummarySection[];
    }
  | {
      ok: false;
      raw: string;
    };

const SUMMARY_HEADER = /^Summary:\s*$/m;
// Section header: a line beginning with "<number>. <Title>:" optionally indented
// by spaces. We tolerate trailing whitespace and CR.
const SECTION_HEADER_RE = /^(\d+)\.\s+([^\n:]+):\s*$/gm;

function dedentBlock(text: string): string {
  // Strip the leading whitespace shared by all non-empty lines.
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const m = line.match(/^[ \t]*/);
    const len = m ? m[0].length : 0;
    if (len < minIndent) minIndent = len;
  }
  if (!Number.isFinite(minIndent) || minIndent === 0) return text.trim();
  return lines
    .map((l) => l.slice(minIndent))
    .join("\n")
    .trim();
}

export function parseCompactSummary(text: string): ParsedCompactSummary {
  if (typeof text !== "string" || text.trim() === "") {
    return { ok: false, raw: typeof text === "string" ? text : "" };
  }

  const headerMatch = text.match(SUMMARY_HEADER);
  if (!headerMatch || headerMatch.index == null) {
    return { ok: false, raw: text };
  }

  const intro = text.slice(0, headerMatch.index).trim();
  const body = text.slice(headerMatch.index + headerMatch[0].length);

  // Find every section header and slice the body between them.
  const headers: Array<{ index: number; title: string; start: number; end: number }> = [];
  // Reset lastIndex to be safe across calls (regex literals are stateful with /g).
  SECTION_HEADER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SECTION_HEADER_RE.exec(body)) != null) {
    headers.push({
      index: Number(m[1]),
      title: m[2].trim(),
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  if (headers.length === 0) {
    return { ok: false, raw: text };
  }

  const sections: CompactSummarySection[] = headers.map((h, i) => {
    const next = headers[i + 1];
    const sliceEnd = next != null ? next.start : body.length;
    const rawBody = body.slice(h.end, sliceEnd);
    return {
      index: h.index,
      title: h.title,
      body: dedentBlock(rawBody),
    };
  });

  return { ok: true, intro, sections };
}
