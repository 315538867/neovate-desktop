import type { FileChange } from "../../../shared/features/agent-orchestrator/schemas";

/**
 * ChangeTracker — 追踪 Stage 执行过程中产生的文件变更。
 * 当前为基础实现，从 executor 的 tool-call/tool-result 事件中提取文件变更信息。
 */
export class ChangeTracker {
  private changes = new Map<string, Map<string, FileChange>>();

  /**
   * 记录一次文件变更
   */
  record(
    runId: string,
    path: string,
    operation: "create" | "modify" | "delete",
    source: "tool-event" | "baseline-diff" = "tool-event",
    toolCallId?: string,
  ): void {
    if (!this.changes.has(runId)) {
      this.changes.set(runId, new Map());
    }

    const runChanges = this.changes.get(runId)!;
    const existing = runChanges.get(path);

    const change: FileChange = {
      path,
      operation,
      source,
      toolCallId,
      timestamp: new Date().toISOString(),
    };

    // 合并操作：后续的 modify 覆盖 create
    if (existing && existing.operation === "create" && operation === "modify") {
      change.beforeHash = existing.beforeHash;
    }

    runChanges.set(path, change);
  }

  /**
   * 获取指定 run 的所有文件变更
   */
  getChanges(runId: string): FileChange[] {
    const runChanges = this.changes.get(runId);
    if (!runChanges) return [];
    return Array.from(runChanges.values());
  }

  /**
   * 清理指定 run 的变更记录
   */
  clear(runId: string): void {
    this.changes.delete(runId);
  }
}
