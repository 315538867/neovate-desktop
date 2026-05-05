import type AdmZip from "adm-zip";

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Safely extract a zip archive to `destDir`, refusing any entry whose
 * resolved path escapes `destDir` (zip-slip).
 *
 * adm-zip's built-in `extractAllTo` does NOT validate entry paths, so a
 * crafted archive can contain entries like `../../../etc/passwd` and
 * write outside the intended directory. We resolve each entry against
 * `destDir` and reject anything outside the tree.
 *
 * Symlinks and other non-regular entries are not honored: adm-zip
 * surfaces them as regular files/directories, so we cannot follow a
 * symlink the archive describes. The path-traversal check is the
 * meaningful guarantee here.
 */
export function safeExtractZip(zip: AdmZip, destDir: string): void {
  const root = path.resolve(destDir) + path.sep;

  for (const entry of zip.getEntries()) {
    const target = path.resolve(destDir, entry.entryName);
    if (target !== path.resolve(destDir) && !target.startsWith(root)) {
      throw new Error(`Refusing to extract zip entry outside target directory: ${entry.entryName}`);
    }

    if (entry.isDirectory) {
      mkdirSync(target, { recursive: true });
      continue;
    }

    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, entry.getData());
  }
}
