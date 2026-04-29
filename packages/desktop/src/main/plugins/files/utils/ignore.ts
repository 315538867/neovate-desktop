const EXCLUDE_FILE_TYPE_PATTERN = [
  "**/node_modules",
  "**/node_modules/**",
  "**/dist",
  "**/dist/**",
  "**/.git",
  "**/.git/**",
  "**/.DS_Store",
  "**/Thumbs.db",
];

/**
 * Get exclude patterns for the file browser.
 *
 * NOTE: We intentionally do NOT apply project `.gitignore` rules here —
 * users still want to see ignored-but-meaningful directories (e.g. `.zcf`,
 * build outputs they want to inspect) in the file tree.
 */
export async function getExcludePatterns(_rootPath: string): Promise<string[]> {
  return EXCLUDE_FILE_TYPE_PATTERN;
}
