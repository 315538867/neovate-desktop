import AdmZip from "adm-zip";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installExtension } from "../installer";

/**
 * The fix in commit 7.1 routes both extraction paths in extractVsix() through
 * safeExtractZip, which rejects entries whose resolved path escapes the target.
 * These tests construct adversarial .vsix archives and assert that:
 *
 *   1. each zip-slip payload throws (no file is written outside the install dir)
 *   2. a benign archive still installs
 *
 * The two extraction code paths in installer.ts are:
 *   - "extension/" prefix present → extracts into _temp_extract/, then renames
 *   - no "extension/" prefix      → extracts directly into targetDir
 * Both must be covered.
 *
 * `ensureExtension` resolves to `<extDir>/neovate-code-extension-0.1.6.vsix`
 * and returns immediately if that file already exists, so each test pre-writes
 * the constructed archive at that exact location to bypass the network fetch.
 */

const VSIX_FILENAME = "neovate-code-extension-0.1.6.vsix";

interface ZipSlipPayload {
  label: string;
  entryName: string;
}

const PAYLOADS: ZipSlipPayload[] = [
  { label: "POSIX traversal", entryName: "../escape.txt" },
  { label: "deep traversal", entryName: "a/b/../../../escape.txt" },
  { label: "Windows-style traversal", entryName: "..\\..\\escape.txt" },
];

describe("installExtension - zip-slip protection", () => {
  let tmpRoot: string;
  let extensionDir: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "neovate-editor-installer-"));
    extensionDir = path.join(tmpRoot, "extensions");
    mkdirSync(extensionDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeVsix(zip: AdmZip): void {
    writeFileSync(path.join(extensionDir, VSIX_FILENAME), zip.toBuffer());
  }

  for (const payload of PAYLOADS) {
    it(`rejects ${payload.label} in archive WITH "extension/" prefix`, async () => {
      const zip = new AdmZip();
      zip.addFile(
        "extension/package.json",
        Buffer.from(JSON.stringify({ publisher: "test", name: "demo", version: "1.0.0" })),
      );
      zip.addFile("placeholder.txt", Buffer.from("pwned"));
      zip.getEntries().at(-1)!.entryName = payload.entryName;
      writeVsix(zip);

      await expect(installExtension(extensionDir)).rejects.toThrow(/outside target directory/);
      // No escape file written above the install dir
      expect(existsSync(path.join(tmpRoot, "escape.txt"))).toBe(false);
      expect(existsSync(path.join(path.dirname(tmpRoot), "escape.txt"))).toBe(false);
    });

    it(`rejects ${payload.label} in archive WITHOUT "extension/" prefix`, async () => {
      const zip = new AdmZip();
      zip.addFile(
        "package.json",
        Buffer.from(JSON.stringify({ publisher: "test", name: "demo", version: "1.0.0" })),
      );
      zip.addFile("placeholder.txt", Buffer.from("pwned"));
      zip.getEntries().at(-1)!.entryName = payload.entryName;
      writeVsix(zip);

      await expect(installExtension(extensionDir)).rejects.toThrow(/outside target directory/);
      expect(existsSync(path.join(tmpRoot, "escape.txt"))).toBe(false);
      expect(existsSync(path.join(path.dirname(tmpRoot), "escape.txt"))).toBe(false);
    });
  }

  it("installs a benign archive successfully", async () => {
    const zip = new AdmZip();
    zip.addFile(
      "extension/package.json",
      Buffer.from(JSON.stringify({ publisher: "neovate", name: "demo", version: "1.0.0" })),
    );
    zip.addFile("extension/README.md", Buffer.from("hello"));
    writeVsix(zip);

    await installExtension(extensionDir);

    expect(existsSync(path.join(extensionDir, "neovate.demo-1.0.0", "package.json"))).toBe(true);
    expect(existsSync(path.join(extensionDir, "neovate.demo-1.0.0", "README.md"))).toBe(true);
    expect(existsSync(path.join(extensionDir, "extensions.json"))).toBe(true);
  });
});
