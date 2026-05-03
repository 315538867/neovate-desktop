/**
 * Parse the *external* protocol used by Claude Code CLI when it persists
 * user turns to jsonl (and emits the same shape over the SDK stream).
 *
 * Claude Code rewrites slash-command inputs into a private XML envelope:
 *
 * ```xml
 * <command-name>/model</command-name>
 * <command-message>model</command-message>
 * <command-args>claude-4.7-opus</command-args>
 * <local-command-stdout>Set model to claude-4.7-opus</local-command-stdout>
 * <local-command-caveat>...</local-command-caveat>
 * ```
 *
 * This function lives at the protocol-↔-semantic boundary: it translates that
 * envelope into our internal domain model (`data-slash-command` parts), so
 * downstream consumers (renderer, sidebar title, rewind prefill) never see
 * the raw XML.
 *
 * Design contract:
 * - Both inbound paths (jsonl restore and live SDK stream) must invoke this
 *   parser, so that the internal event model is symmetric regardless of
 *   delivery mode.
 * - Recognized tags are a strict whitelist. Anything else is preserved as
 *   plain text, including stray `<` characters in normal prose.
 * - Parsing never throws: malformed envelopes degrade to plain text.
 * - File parts (images) inside an `Array` content are passed through; their
 *   relative ordering with text/slash-command parts is preserved.
 */

import type { ClaudeCodeUIMessage } from "./types";

type Part = ClaudeCodeUIMessage["parts"][number];

const RECOGNIZED_TAGS = [
  "command-name",
  "command-message",
  "command-args",
  "local-command-stdout",
  "local-command-caveat",
] as const;
type RecognizedTag = (typeof RECOGNIZED_TAGS)[number];

const TAG_REGEX_CACHE = new Map<RecognizedTag, RegExp>();
function tagRegex(tag: RecognizedTag): RegExp {
  let cached = TAG_REGEX_CACHE.get(tag);
  if (!cached) {
    // [\s\S] for cross-line content; non-greedy to stop at first close.
    cached = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
    TAG_REGEX_CACHE.set(tag, cached);
  }
  return cached;
}

/**
 * Find the next slash-command block starting at or after `from` in `text`.
 * A block is anchored by `<command-name>...</command-name>`, then absorbs
 * any of the other recognized tags that immediately follow (whitespace
 * between tags is allowed and discarded).
 */
type BlockFields = {
  name: string;
  message?: string;
  args?: string;
  stdout?: string;
  caveat?: string;
  /** Free text the user inserted between the command anchor and its
   *  side-effect tags (e.g. a "回退到此处" rewind marker). */
  extraText?: string;
};

type BlockMatch = {
  /** Start index of the block in the source string (inclusive). */
  start: number;
  /** End index of the block in the source string (exclusive). */
  end: number;
  fields: BlockFields;
};

function findNextBlock(text: string, from: number): BlockMatch | null {
  const nameOpen = "<command-name>";
  const idx = text.indexOf(nameOpen, from);
  if (idx === -1) return null;

  const m = text.slice(idx).match(tagRegex("command-name"));
  if (!m || m.index !== 0) return null;

  const rawName = (m[1] ?? "").trim();
  if (!rawName) {
    // Anchor present but empty payload — not a valid command, treat as text.
    return null;
  }

  const fields: BlockFields = { name: rawName.replace(/^\/+/, "") };
  let blockStart = idx;
  let cursor = idx + m[0].length;

  // ── Phase A0: pre-anchor lookback for <command-message> ──────────────────
  //
  // The CLI actually emits `<command-message>` *before* `<command-name>` (not
  // after — earlier assumptions in Phase A were wrong). When the closing
  // `</command-message>` sits on the immediate left of `<command-name>` with
  // only whitespace between them, absorb it into this block and pull
  // `blockStart` back to the opening `<command-message>` tag. This must stay
  // within `[from, idx)` so we don't reach into a sibling block on the left.
  {
    const leftRegion = text.slice(from, idx);
    const lookback = leftRegion.match(/<command-message>([\s\S]*?)<\/command-message>\s*$/);
    if (lookback && lookback.index != null) {
      fields.message = (lookback[1] ?? "").trim();
      blockStart = from + lookback.index;
    }
  }

  // ── Phase A: tightly-adjacent fields ─────────────────────────────────────
  //
  // `<command-args>` is emitted by the CLI in the same write as
  // `<command-name>`, with at most whitespace between them. (`<command-message>`
  // is handled by Phase A0 above; some legacy/duplicate emissions may still
  // place a redundant `<command-message>` right after the anchor — we tolerate
  // that by accepting it here too, but `message` is already set so the second
  // copy does not overwrite Phase A0's capture unless A0 missed.)
  const adjacent = new Set<RecognizedTag>(["command-message", "command-args"]);
  while (adjacent.size > 0) {
    const slice = text.slice(cursor);
    const wsMatch = slice.match(/^\s*/);
    const wsLen = wsMatch ? wsMatch[0].length : 0;
    const afterWs = slice.slice(wsLen);

    let matched: RecognizedTag | null = null;
    for (const tag of adjacent) {
      if (afterWs.startsWith(`<${tag}>`)) {
        matched = tag;
        break;
      }
    }
    if (!matched) break;

    const tm = afterWs.match(tagRegex(matched));
    if (!tm || tm.index !== 0) break;

    const value = (tm[1] ?? "").trim();
    if (matched === "command-message") {
      // Don't overwrite a Phase A0 capture; just consume the duplicate.
      if (fields.message == null) fields.message = value;
    } else {
      fields.args = value;
    }
    adjacent.delete(matched);
    cursor += wsLen + tm[0].length;
  }

  // ── Phase B: side-effect outputs ─────────────────────────────────────────
  //
  // `<local-command-stdout>` / `<local-command-caveat>` are emitted by the
  // CLI *after* the user-visible turn boundary, but before the next user
  // command. They may be separated from the anchor by free text (for
  // example a "回退到此处" rewind marker the user inserted between turns).
  // Search forward but never cross the next `<command-name>` — that would
  // belong to a sibling block.
  const tightEnd = cursor;
  const nextAnchor = text.indexOf(nameOpen, cursor);
  const sideEffectScanLimit = nextAnchor === -1 ? text.length : nextAnchor;
  const sideEffectRegion = text.slice(cursor, sideEffectScanLimit);

  let blockEnd = cursor;
  let stdoutLocalEnd = -1;
  let caveatLocalEnd = -1;

  const stdoutMatch = sideEffectRegion.match(tagRegex("local-command-stdout"));
  if (stdoutMatch && stdoutMatch.index != null) {
    fields.stdout = (stdoutMatch[1] ?? "").trim();
    stdoutLocalEnd = stdoutMatch.index + stdoutMatch[0].length;
  }
  const caveatMatch = sideEffectRegion.match(tagRegex("local-command-caveat"));
  if (caveatMatch && caveatMatch.index != null) {
    fields.caveat = (caveatMatch[1] ?? "").trim();
    caveatLocalEnd = caveatMatch.index + caveatMatch[0].length;
  }

  // Block extent = furthest right between the tight section and any
  // side-effect tags consumed. Free text *between* tight end and the side
  // effect tag is left in the source for the outer loop, EXCEPT that it
  // sits inside the block's inclusive end span — so we still report the
  // outer end as the rightmost consumed offset and the absorbExtraText
  // pass below will merge any leading free text into `extraText`.
  const farthest = Math.max(tightEnd, stdoutLocalEnd === -1 ? -1 : cursor + stdoutLocalEnd);
  const farthestWithCaveat = Math.max(
    farthest,
    caveatLocalEnd === -1 ? -1 : cursor + caveatLocalEnd,
  );
  blockEnd = farthestWithCaveat;

  // Capture any free text that appeared between the tight section and the
  // first side-effect tag — it's part of this turn (the user's adjunct
  // prose like "回退到此处").
  if (stdoutLocalEnd !== -1 || caveatLocalEnd !== -1) {
    const firstSideEffectStart = Math.min(
      stdoutMatch?.index ?? Number.POSITIVE_INFINITY,
      caveatMatch?.index ?? Number.POSITIVE_INFINITY,
    );
    if (firstSideEffectStart > 0 && Number.isFinite(firstSideEffectStart)) {
      const interText = sideEffectRegion.slice(0, firstSideEffectStart).trim();
      if (interText.length > 0) {
        fields.extraText = interText;
      }
    }
  }

  return { start: blockStart, end: blockEnd, fields };
}

/**
 * Strip any orphaned recognized tags that did not become part of a domain
 * event (e.g. a stray `<command-message>` that was not preceded by a
 * `<command-name>`). Keep the inner text — it's the human-meaningful part.
 */
function stripOrphanTags(text: string): string {
  let out = text;
  for (const tag of RECOGNIZED_TAGS) {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "g");
    out = out.replace(re, (_full, inner: string) => inner);
  }
  return out;
}

/**
 * Detect a *bare* slash-command prefix at the line-start position `cursor`.
 *
 * User-level slash commands defined under `~/.claude/commands/<name>.md` are
 * NOT rewritten by the CLI into the `<command-name>` XML envelope; they land
 * in jsonl as bare prose like `/zcf:workflow 你好`. Recognize them so the
 * restore path produces a `data-slash-command` part symmetric to the
 * editor's optimistic emit.
 *
 * Conservative anchoring rules to avoid false positives:
 *   - Must start exactly at `cursor` (caller guarantees it's at a line start).
 *   - First name char must be a letter (rejects `/path/...`).
 *   - Name body uses `[\w:-]` (supports `zcf:workflow`, `zcf-workflow`).
 *   - The name must terminate at end-of-string OR a whitespace character —
 *     a trailing `/` (as in `/path/to/file`) does not match.
 *   - Args, if present, span from the first whitespace to end-of-line
 *     (next `\n` exclusive) so the bare command consumes only one line.
 */
type BareSlashMatch = {
  /** Length consumed from `cursor`, including the leading `/`. */
  length: number;
  fields: BlockFields;
};

function matchBareSlashCommand(text: string, cursor: number): BareSlashMatch | null {
  if (text.charCodeAt(cursor) !== 0x2f /* "/" */) return null;
  // Name: letter, then [A-Za-z0-9_:-]*
  let i = cursor + 1;
  const first = text.charCodeAt(i);
  const isAlpha =
    (first >= 0x41 && first <= 0x5a) /* A-Z */ || (first >= 0x61 && first <= 0x7a) /* a-z */;
  if (!isAlpha) return null;
  i++;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    const isAlnum =
      (c >= 0x41 && c <= 0x5a) ||
      (c >= 0x61 && c <= 0x7a) ||
      (c >= 0x30 && c <= 0x39) /* 0-9 */ ||
      c === 0x5f /* _ */ ||
      c === 0x3a /* : */ ||
      c === 0x2d /* - */;
    if (!isAlnum) break;
    i++;
  }
  const name = text.slice(cursor + 1, i);
  if (!name) return null;

  // Terminator: end-of-string, or whitespace. A non-whitespace, non-name char
  // (e.g. `/foo.bar` or `/path/to`) means this isn't a slash command.
  const terminator = i < text.length ? text.charCodeAt(i) : -1;
  const isEndOrWs =
    terminator === -1 || terminator === 0x20 || terminator === 0x09 || terminator === 0x0a;
  if (!isEndOrWs) return null;

  // Args: from `i` (a whitespace char) to next `\n` exclusive. Trim left
  // whitespace and any trailing whitespace; preserve internal whitespace.
  let argsEnd = text.length;
  for (let j = i; j < text.length; j++) {
    if (text.charCodeAt(j) === 0x0a) {
      argsEnd = j;
      break;
    }
  }
  const argsRaw = text.slice(i, argsEnd).trim();
  const fields: BlockFields = { name };
  if (argsRaw) fields.args = argsRaw;
  return { length: argsEnd - cursor, fields };
}

function isAtLineStart(text: string, cursor: number): boolean {
  return cursor === 0 || text.charCodeAt(cursor - 1) === 0x0a /* \n */;
}

/**
 * Find the next *bare* slash-command position in `text` at or after `from`.
 * Bare commands must sit at a line start (cursor === 0 or prev char is `\n`).
 * Returns the absolute index of the leading `/` and the parsed match, or null.
 */
function findNextBareSlashCommand(
  text: string,
  from: number,
): { start: number; match: BareSlashMatch } | null {
  let pos = from;
  while (pos < text.length) {
    let candidate = -1;
    if (isAtLineStart(text, pos) && text.charCodeAt(pos) === 0x2f) {
      candidate = pos;
    } else {
      // Find next `\n/` boundary.
      const nl = text.indexOf("\n/", pos);
      if (nl === -1) return null;
      candidate = nl + 1;
    }
    const match = matchBareSlashCommand(text, candidate);
    if (match) return { start: candidate, match };
    // Skip past this candidate and keep scanning.
    pos = candidate + 1;
  }
  return null;
}

/**
 * Split a flat string into an alternating sequence of `text` and
 * `data-slash-command` parts.
 */
function splitText(text: string): Part[] {
  const out: Part[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const block = findNextBlock(text, cursor);
    const bare = findNextBareSlashCommand(text, cursor);

    // Pick whichever event starts first. XML envelope wins on ties (it's the
    // more specific format and conveys richer fields).
    let pickXml = false;
    let pickBare = false;
    if (block && bare) {
      if (block.start <= bare.start) pickXml = true;
      else pickBare = true;
    } else if (block) {
      pickXml = true;
    } else if (bare) {
      pickBare = true;
    }

    if (!pickXml && !pickBare) {
      const tail = text.slice(cursor);
      pushText(out, stripOrphanTags(tail));
      break;
    }

    if (pickXml && block) {
      if (block.start > cursor) {
        pushText(out, stripOrphanTags(text.slice(cursor, block.start)));
      }
      out.push({
        type: "data-slash-command",
        data: { ...block.fields },
      } as Part);
      cursor = block.end;
    } else if (pickBare && bare) {
      if (bare.start > cursor) {
        pushText(out, stripOrphanTags(text.slice(cursor, bare.start)));
      }
      out.push({
        type: "data-slash-command",
        data: { ...bare.match.fields },
      } as Part);
      cursor = bare.start + bare.match.length;
    }
  }
  return out;
}

function pushText(parts: Part[], text: string): void {
  if (text.length === 0) return;
  // Merge with previous text to keep parts compact.
  const last = parts[parts.length - 1];
  if (last && last.type === "text") {
    (last as { type: "text"; text: string }).text += text;
    return;
  }
  parts.push({ type: "text", text, state: "done" } as Part);
}

/** Public entry point. */
export function parseCliUserContent(content: unknown): { parts: Part[] } {
  if (typeof content === "string") {
    return { parts: splitText(content) };
  }

  if (!Array.isArray(content)) {
    return { parts: [] };
  }

  const parts: Part[] = [];
  let textBuffer = "";

  const flushText = () => {
    if (!textBuffer) return;
    const split = splitText(textBuffer);
    for (const p of split) parts.push(p);
    textBuffer = "";
  };

  for (const block of content) {
    if (block == null || typeof block !== "object") continue;
    const b = block as { type?: unknown };
    if (b.type === "text") {
      const t = (b as { text?: unknown }).text;
      if (typeof t === "string") textBuffer += t;
    } else if (b.type === "image") {
      flushText();
      const src = (b as { source?: { type?: string; media_type?: string; data?: string } }).source;
      if (src?.type === "base64" && typeof src.data === "string") {
        const mediaType = src.media_type ?? "image/png";
        parts.push({
          type: "file",
          mediaType,
          url: `data:${mediaType};base64,${src.data}`,
        } as Part);
      }
    }
    // Other block types (e.g. tool_result) are intentionally not handled here:
    // they belong to a different message shape and are not produced by the
    // human-prompt path that this parser serves.
  }

  flushText();
  return { parts };
}
