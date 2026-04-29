import type { SubtaskRecord } from "../../../../shared/features/agent-orchestrator/schemas";

/**
 * SubtaskTracker — 追踪 executor 的工具调用并将其映射为子任务。
 *
 * 当 orchestrator 收到 tool-call 事件时，通过此 tracker 记录、
 * 更新子任务状态，并关联到对应的 callId。
 */
export class SubtaskTracker {
  private subtasks = new Map<string, SubtaskRecord[]>();

  /**
   * 创建一个新的子任务
   */
  startSubtask(runId: string, stageInstanceId: string, taskId: string, description: string): void {
    const subtask: SubtaskRecord = {
      taskId,
      description,
      status: "running",
      startedAt: new Date().toISOString(),
      retryCount: 0,
      filesChanged: [],
      parentStageInstanceId: stageInstanceId,
    };

    if (!this.subtasks.has(runId)) {
      this.subtasks.set(runId, []);
    }
    this.subtasks.get(runId)!.push(subtask);
  }

  /**
   * 标记子任务完成
   */
  completeSubtask(runId: string, taskId: string): void {
    const tasks = this.subtasks.get(runId);
    if (!tasks) return;

    const task = tasks.find((t) => t.taskId === taskId);
    if (task) {
      task.status = "done";
      task.finishedAt = new Date().toISOString();
    }
  }

  /**
   * 标记子任务失败
   */
  failSubtask(runId: string, taskId: string, error: string): void {
    const tasks = this.subtasks.get(runId);
    if (!tasks) return;

    const task = tasks.find((t) => t.taskId === taskId);
    if (task) {
      task.status = "failed";
      task.errorMessage = error;
      task.finishedAt = new Date().toISOString();
    }
  }

  /**
   * 获取 run 的所有子任务
   */
  getSubtasks(runId: string): SubtaskRecord[] {
    return this.subtasks.get(runId) ?? [];
  }

  /**
   * 获取 stage 的子任务
   */
  getStageSubtasks(runId: string, stageInstanceId: string): SubtaskRecord[] {
    const tasks = this.subtasks.get(runId);
    if (!tasks) return [];
    return tasks.filter((t) => t.parentStageInstanceId === stageInstanceId);
  }

  /**
   * 计算子任务进度
   */
  getProgress(runId: string): { total: number; done: number; failed: number; running: number } {
    const tasks = this.subtasks.get(runId) ?? [];
    return {
      total: tasks.length,
      done: tasks.filter((t) => t.status === "done").length,
      failed: tasks.filter((t) => t.status === "failed").length,
      running: tasks.filter((t) => t.status === "running").length,
    };
  }

  /**
   * 清理 run 的子任务记录
   */
  clear(runId: string): void {
    this.subtasks.delete(runId);
  }
}
