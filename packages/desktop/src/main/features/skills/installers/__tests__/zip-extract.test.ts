import AdmZip from "adm-zip";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { safeExtractZip } from "../zip-extract";

describe("safeExtractZip", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "neovate-zipslip-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("extracts ordinary entries into destDir", () => {
    const zip = new AdmZip();
    zip.addFile("hello.txt", Buffer.from("hi"));
    zip.addFile("nested/inner.txt", Buffer.from("ok"));

    safeExtractZip(zip, tmp);

    expect(readFileSync(path.join(tmp, "hello.txt"), "utf8")).toBe("hi");
    expect(readFileSync(path.join(tmp, "nested/inner.txt"), "utf8")).toBe("ok");
  });

  it("rejects entries that traverse outside destDir", () => {
    const zip = new AdmZip();
    zip.addFile("placeholder.txt", Buffer.from("pwned"));
    zip.getEntries()[0]!.entryName = "../escape.txt";

    expect(() => safeExtractZip(zip, tmp)).toThrow(/outside target directory/);
    expect(existsSync(path.join(path.dirname(tmp), "escape.txt"))).toBe(false);
  });

  it("rejects deeply nested traversal entries", () => {
    const zip = new AdmZip();
    zip.addFile("placeholder.txt", Buffer.from("pwned"));
    zip.getEntries()[0]!.entryName = "a/b/../../../escape.txt";

    expect(() => safeExtractZip(zip, tmp)).toThrow(/outside target directory/);
  });
});
