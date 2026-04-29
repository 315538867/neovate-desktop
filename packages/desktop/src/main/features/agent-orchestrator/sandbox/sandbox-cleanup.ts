import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * 启动时清理孤立的 sandbox 目录。
 */
export function cleanupOrphanSandboxes(sandboxBaseDir: string, activeRunIds: Set<string>): void {
  if (!existsSync(sandboxBaseDir)) return;

  const entries = readdirSync(sandboxBaseDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    // 跳过活跃 run 的 sandbox
    if (activeRunIds.has(entry.name)) continue;

    const dirPath = path.join(sandboxBaseDir, entry.name);
    try {
      rmSync(dirPath, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  }
}
