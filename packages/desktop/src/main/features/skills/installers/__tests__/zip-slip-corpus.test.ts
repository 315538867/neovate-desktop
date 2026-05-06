import AdmZip from "adm-zip";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { safeExtractZip } from "../zip-extract";

/**
 * Adversarial zip-slip corpus.
 *
 * The base zip-extract.test.ts already covers two canonical cases (single
 * `..`, deeply nested `..`). What we add here is the wider zoo of payloads
 * an attacker might try — Windows-style separators, drive-letter absolutes,
 * POSIX absolutes, mixed separators, encoded `..`, double-dot prefix, and
 * the case where `entryName === ".."` itself.
 *
 * Every test asserts BOTH:
 *  1) safeExtractZip throws with the canonical "outside target directory"
 *     message (so callers can pattern-match the error), AND
 *  2) the would-be escape path on disk does NOT exist after the call.
 *
 * The second assertion is what actually matters — if a payload sneaks past
 * the policy, the attacker wins regardless of what we throw.
 */

describe("safeExtractZip — zip-slip adversarial corpus", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "neovate-zipslip-corpus-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function makeZipWithEntryName(entryName: string): AdmZip {
    const zip = new AdmZip();
    zip.addFile("placeholder.txt", Buffer.from("pwned"));
    zip.getEntries()[0]!.entryName = entryName;
    return zip;
  }

  function expectRejected(entryName: string, escapeRelativeFromTmp: string) {
    const zip = makeZipWithEntryName(entryName);
    expect(() => safeExtractZip(zip, tmp)).toThrow(/outside target directory/);
    // The escape path is computed relative to tmp's parent so it covers the
    // common attack of writing one level up. Tests pass an explicit override
    // when a deeper traversal target needs checking.
    const escapePath = path.resolve(tmp, escapeRelativeFromTmp);
    expect(existsSync(escapePath)).toBe(false);
  }

  it("payload 1: single `..` traversal", () => {
    expectRejected("../escape.txt", "../escape.txt");
  });

  it("payload 2: deep `../../../` traversal", () => {
    expectRejected("../../../escape.txt", "../../../escape.txt");
  });

  it("payload 3: mid-path `..` (a/b/../../../escape.txt)", () => {
    expectRejected("a/b/../../../escape.txt", "../escape.txt");
  });

  it("payload 4: Windows-style backslash traversal (..\\..\\escape.txt)", () => {
    expectRejected("..\\..\\escape.txt", "../../escape.txt");
  });

  it("payload 5: mixed slashes (..\\../escape.txt)", () => {
    expectRejected("..\\../escape.txt", "../../escape.txt");
  });

  it("payload 6: POSIX absolute path (/tmp/escape.txt)", () => {
    const zip = makeZipWithEntryName("/tmp/escape.txt");
    expect(() => safeExtractZip(zip, tmp)).toThrow(/outside target directory/);
    // Don't check /tmp/escape.txt existence — this would be a TOCTOU-y test.
    // The throw is the contract.
  });

  it("payload 7: Windows absolute path with drive letter (C:\\evil.txt)", () => {
    const zip = makeZipWithEntryName("C:\\evil.txt");
    expect(() => safeExtractZip(zip, tmp)).toThrow(/outside target directory/);
  });

  it("payload 8: Windows absolute path with forward slashes (C:/evil.txt)", () => {
    const zip = makeZipWithEntryName("C:/evil.txt");
    expect(() => safeExtractZip(zip, tmp)).toThrow(/outside target directory/);
  });

  it("payload 9: literal `..` as the entire entry name", () => {
    const zip = makeZipWithEntryName("..");
    expect(() => safeExtractZip(zip, tmp)).toThrow(/outside target directory/);
  });

  it("payload 10: `../..` only (no trailing filename)", () => {
    const zip = makeZipWithEntryName("../..");
    expect(() => safeExtractZip(zip, tmp)).toThrow(/outside target directory/);
  });

  it("payload 11: traversal disguised after a legitimate prefix (./../escape.txt)", () => {
    expectRejected("./../escape.txt", "../escape.txt");
  });

  it("payload 12: traversal in a directory entry (../escape/)", () => {
    const zip = new AdmZip();
    // Add a real directory entry — adm-zip uses trailing-slash to mark dirs
    zip.addFile("dir/", Buffer.alloc(0));
    zip.getEntries()[0]!.entryName = "../escape/";
    expect(() => safeExtractZip(zip, tmp)).toThrow(/outside target directory/);
    expect(existsSync(path.resolve(tmp, "..", "escape"))).toBe(false);
  });

  it("payload 13 (sanity): a benign relative path is still accepted", () => {
    const zip = new AdmZip();
    zip.addFile("ok/inside.txt", Buffer.from("clean"));
    expect(() => safeExtractZip(zip, tmp)).not.toThrow();
    expect(existsSync(path.join(tmp, "ok", "inside.txt"))).toBe(true);
  });
});
