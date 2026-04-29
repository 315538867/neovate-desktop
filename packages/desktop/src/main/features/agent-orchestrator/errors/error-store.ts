import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { StageError } from "../../../../shared/features/agent-orchestrator/schemas";

export interface ErrorEntry {
  timestamp: string;
  runId: string;
  stageInstanceId: string;
  error: StageError;
  context?: string;
}

/**
 * ErrorStore — 持久化错误日志 (errors.jsonl)。
 * 追加写入，用于事后分析和 UI 展示。
 */
export class ErrorStore {
  private baseDir: string;

  constructor(appDataDir: string) {
    this.baseDir = path.join(appDataDir, "orchestrator", "errors");
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  getFilePath(runId: string): string {
    const safe = runId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.baseDir, `${safe}.jsonl`);
  }

  /**
   * 记录错误
   */
  record(runId: string, stageInstanceId: string, error: StageError, context?: string): void {
    const entry: ErrorEntry = {
      timestamp: new Date().toISOString(),
      runId,
      stageInstanceId,
      error,
      context,
    };
    appendFileSync(this.getFilePath(runId), JSON.stringify(entry) + "\n", "utf-8");
  }

  /**
   * 按错误级别过滤读取
   */
  getErrors(runId: string, minLevel?: string): ErrorEntry[] {
    const filePath = this.getFilePath(runId);
    if (!existsSync(filePath)) return [];

    const content = readFileSync(filePath, "utf-8");
    const entries: ErrorEntry[] = [];
    for (const line of content.split("\n").filter(Boolean)) {
      try {
        const parsed = JSON.parse(line) as ErrorEntry;
        if (!minLevel || this.compareLevel(parsed.error.level, minLevel) >= 0) {
          entries.push(parsed);
        }
      } catch {
        // skip
      }
    }
    return entries;
  }

  /**
   * 按 stage 分组错误统计
   */
  getErrorStats(runId: string): Record<string, number> {
    const errors = this.getErrors(runId);
    const stats: Record<string, number> = {};
    for (const entry of errors) {
      const code = entry.error.code;
      stats[code] = (stats[code] ?? 0) + 1;
    }
    return stats;
  }

  private compareLevel(a: string, b: string): number {
    const levels = ["L0", "L1", "L2", "L3", "L4"];
    return levels.indexOf(a) - levels.indexOf(b);
  }
}
