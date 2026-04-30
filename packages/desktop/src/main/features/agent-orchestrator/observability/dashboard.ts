import type { PipelineRun } from "../../../../shared/features/agent-orchestrator/schemas";

export interface DashboardStats {
  totalTokens: number;
  totalCost: number;
  durationMs: number;
  stageCount: number;
  completedStageCount: number;
  failedStageCount: number;
  skippedStageCount: number;
  awaitingUserStageCount: number;
  stageDetails: StageDetailEntry[];
  fanOutStats: FanOutStat[];
}

export interface StageDetailEntry {
  instanceId: string;
  stageId: string;
  status: string;
  executorId: string;
  attempt: number;
  durationMs: number | null;
  errorCount: number;
  hasOutput: boolean;
  isFanOutParent: boolean;
  isFanOutChild: boolean;
}

export interface FanOutStat {
  parentInstanceId: string;
  childCount: number;
  completedChildren: number;
}

/**
 * DashboardGenerator — 生成 Pipeline Run 的概览 dashboard。
 *
 * 输出:
 *   - Markdown 格式的概览文档
 *   - 结构化统计信息
 */
export class DashboardGenerator {
  /**
   * 生成 Markdown 概览
   */
  generateMarkdown(run: PipelineRun): string {
    const stats = this.computeStats(run);
    const lines: string[] = [];

    // Header
    lines.push(`# Pipeline Run: ${run.runId.substring(0, 8)}`);
    lines.push("");
    lines.push(`- **Template**: ${run.templateId}`);
    lines.push(`- **Status**: \`${run.status}\``);
    lines.push(`- **Created**: ${run.createdAt}`);
    if (run.completedAt) {
      lines.push(`- **Completed**: ${run.completedAt}`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");

    // Budget
    if (run.budget) {
      lines.push("## Budget");
      lines.push("");
      lines.push("| Resource | Used | Limit |");
      lines.push("| -------- | ---- | ----- |");
      if (run.budget.maxTokens) {
        lines.push(`| Tokens | ${run.budget.usedTokens} | ${run.budget.maxTokens} |`);
      }
      if (run.budget.maxCost) {
        lines.push(
          `| Cost | $${run.budget.usedCost.toFixed(4)} | $${run.budget.maxCost.toFixed(4)} |`,
        );
      }
      if (run.budget.maxDurationMs) {
        lines.push(
          `| Duration | ${this.formatDuration(run.budget.usedDurationMs)} | ${this.formatDuration(run.budget.maxDurationMs)} |`,
        );
      }
      lines.push("");
    }

    // Stage Overview
    lines.push("## Stages");
    lines.push("");
    lines.push(`| Instance | Stage | Status | Attempt | Duration | Errors |`);
    lines.push(`| -------- | ----- | ------ | ------- | -------- | ------ |`);

    for (const entry of stats.stageDetails) {
      const statusEmoji =
        entry.status === "completed"
          ? "✅"
          : entry.status === "failed"
            ? "❌"
            : entry.status === "running"
              ? "🔄"
              : entry.status === "awaiting_user"
                ? "👤"
                : entry.status === "skipped"
                  ? "⏭️"
                  : entry.status === "pending"
                    ? "⏳"
                    : "❓";

      lines.push(
        `| ${entry.instanceId}${entry.isFanOutChild ? " 🔀" : ""} | ${entry.stageId} | ${statusEmoji} ${entry.status} | ${entry.attempt} | ${entry.durationMs != null ? this.formatDuration(entry.durationMs) : "-"} | ${entry.errorCount} |`,
      );
    }
    lines.push("");

    // Summary
    lines.push(`**Progress**: ${stats.completedStageCount}/${stats.stageCount} stages completed`);
    if (stats.failedStageCount > 0) {
      lines.push(`**Failed**: ${stats.failedStageCount} stage(s)`);
      lines.push("");
    }

    // Fan-out stats
    if (stats.fanOutStats.length > 0) {
      lines.push("## Fan-Out");
      lines.push("");
      for (const fan of stats.fanOutStats) {
        lines.push(
          `- **${fan.parentInstanceId}**: ${fan.completedChildren}/${fan.childCount} children completed`,
        );
      }
      lines.push("");
    }

    // Failure info
    const failedStages = run.stageRuns.filter((s) => s.status === "failed");
    if (failedStages.length > 0) {
      lines.push("## Failures");
      lines.push("");
      for (const stage of failedStages) {
        lines.push(`### ${stage.instanceId} (${stage.stageId})`);
        if (stage.fatalError) {
          lines.push(
            `- Fatal: ${stage.fatalError.code} - ${stage.fatalError.providerMessage ?? "Unknown"}`,
          );
        }
        for (const err of stage.errors) {
          lines.push(`- [${err.level}] \`${err.code}\`: ${err.providerMessage ?? "No message"}`);
        }
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  /**
   * 生成结构化统计
   */
  computeStats(run: PipelineRun): DashboardStats {
    const stageDetails: StageDetailEntry[] = run.stageRuns.map((s) => ({
      instanceId: s.instanceId,
      stageId: s.stageId,
      status: s.status,
      executorId: s.executorId,
      attempt: s.attempt,
      durationMs:
        s.startedAt && s.completedAt ? Date.parse(s.completedAt) - Date.parse(s.startedAt) : null,
      errorCount: s.errors.length,
      hasOutput: s.output != null,
      isFanOutParent: run.stageRuns.some((child) => child.fanOutParentInstanceId === s.instanceId),
      isFanOutChild: !!s.fanOutParentInstanceId,
    }));

    const fanOutParents = new Set(
      run.stageRuns.filter((s) => s.fanOutParentInstanceId).map((s) => s.fanOutParentInstanceId!),
    );

    const fanOutStats: FanOutStat[] = Array.from(fanOutParents).map((parentId) => {
      const children = run.stageRuns.filter((s) => s.fanOutParentInstanceId === parentId);
      return {
        parentInstanceId: parentId,
        childCount: children.length,
        completedChildren: children.filter(
          (c) => c.status === "completed" || c.status === "skipped",
        ).length,
      };
    });

    return {
      totalTokens: run.budget?.usedTokens ?? 0,
      totalCost: run.budget?.usedCost ?? 0,
      durationMs: run.budget?.usedDurationMs ?? 0,
      stageCount: run.stageRuns.length,
      completedStageCount: stageDetails.filter(
        (s) => s.status === "completed" || s.status === "skipped",
      ).length,
      failedStageCount: stageDetails.filter((s) => s.status === "failed").length,
      skippedStageCount: stageDetails.filter((s) => s.status === "skipped").length,
      awaitingUserStageCount: stageDetails.filter((s) => s.status === "awaiting_user").length,
      stageDetails,
      fanOutStats,
    };
  }

  /**
   * 生成 events.jsonl 切片建议
   */
  suggestSliceInterval(eventCount: number): { sliceSize: number; sliceCount: number } {
    const MAX_PER_SLICE = 1000;
    if (eventCount <= MAX_PER_SLICE) {
      return { sliceSize: eventCount, sliceCount: 1 };
    }
    const sliceCount = Math.ceil(eventCount / MAX_PER_SLICE);
    const sliceSize = Math.ceil(eventCount / sliceCount);
    return { sliceSize, sliceCount };
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.round((ms % 60_000) / 1000);
    return `${minutes}m${seconds}s`;
  }
}
