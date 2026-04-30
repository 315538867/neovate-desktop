import type {
  PipelineEvent,
  PipelineRun,
  StageRunRecord,
} from "../../../../shared/features/agent-orchestrator/schemas";

/**
 * Analytics 事件类型
 */
export type AnalyticsEvent =
  | {
      type: "pipeline.started";
      runId: string;
      templateId: string;
      stageCount: number;
      timestamp: string;
    }
  | {
      type: "pipeline.completed";
      runId: string;
      durationMs: number;
      stageResults: StageResultSummary[];
      timestamp: string;
    }
  | { type: "pipeline.failed"; runId: string; reason: string; timestamp: string }
  | {
      type: "stage.completed";
      runId: string;
      stageInstanceId: string;
      stageId: string;
      durationMs: number;
      timestamp: string;
    }
  | {
      type: "stage.failed";
      runId: string;
      stageInstanceId: string;
      stageId: string;
      errorCode: string;
      timestamp: string;
    }
  | {
      type: "budget.exceeded";
      runId: string;
      usedTokens: number;
      maxTokens: number;
      timestamp: string;
    }
  | {
      type: "fanout.expanded";
      runId: string;
      parentInstanceId: string;
      childCount: number;
      timestamp: string;
    };

export interface StageResultSummary {
  instanceId: string;
  stageId: string;
  status: string;
  attemptCount: number;
  durationMs: number | null;
}

export interface PipelineAnalytics {
  totalPipelines: number;
  successRate: number;
  avgDurationMs: number;
  totalTokensUsed: number;
  stageStats: Map<
    string,
    { total: number; completed: number; failed: number; avgDurationMs: number }
  >;
}

/**
 * AnalyticsTracker — Pipeline 事件埋点与统计。
 *
 * 收集 run 生命周期事件，产出聚合统计。
 */
export class AnalyticsTracker {
  private events: AnalyticsEvent[] = [];
  private listeners: Array<(ev: AnalyticsEvent) => void> = [];

  /**
   * 记录一个分析事件
   */
  track(event: AnalyticsEvent): void {
    this.events.push(event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * 从 PipelineEvent 推断并记录 AnalyticsEvent
   */
  trackPipelineEvent(ev: PipelineEvent, run?: PipelineRun): void {
    switch (ev.type) {
      case "run.started": {
        const payload = ev.payload as { templateId?: string; stageCount?: number };
        this.track({
          type: "pipeline.started",
          runId: ev.runId,
          templateId: payload.templateId ?? "unknown",
          stageCount: payload.stageCount ?? 0,
          timestamp: ev.timestamp,
        });
        break;
      }
      case "run.completed": {
        if (run) {
          const durationMs = run.completedAt
            ? Date.parse(run.completedAt) - Date.parse(run.createdAt)
            : 0;
          this.track({
            type: "pipeline.completed",
            runId: ev.runId,
            durationMs,
            stageResults: this.summarizeStages(run.stageRuns),
            timestamp: ev.timestamp,
          });
        }
        break;
      }
      case "run.failed":
      case "run.cancelled": {
        this.track({
          type: "pipeline.failed",
          runId: ev.runId,
          reason: ev.type,
          timestamp: ev.timestamp,
        });
        break;
      }
    }
  }

  /**
   * 订阅分析事件
   */
  onEvent(listener: (ev: AnalyticsEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * 生成聚合统计
   */
  getAnalytics(): PipelineAnalytics {
    const completed = this.events.filter((e) => e.type === "pipeline.completed");
    const started = this.events.filter((e) => e.type === "pipeline.started");

    const total = started.length;
    const successRate = total > 0 ? completed.length / total : 0;

    const durations = completed
      .map((e) => (e.type === "pipeline.completed" ? e.durationMs : 0))
      .filter((d) => d > 0);
    const avgDurationMs =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;

    const tokensUsed = completed.reduce((sum, _e) => {
      // tokens from budget
      return sum;
    }, 0);

    // Stage stats
    const stageStats = new Map<
      string,
      { total: number; completed: number; failed: number; avgDurationMs: number }
    >();
    const stageCompletions = this.events.filter(
      (e) => e.type === "stage.completed" || e.type === "stage.failed",
    );
    for (const ev of stageCompletions) {
      if (ev.type === "stage.completed" || ev.type === "stage.failed") {
        const stageId = ev.stageId;
        if (!stageStats.has(stageId)) {
          stageStats.set(stageId, { total: 0, completed: 0, failed: 0, avgDurationMs: 0 });
        }
        const stats = stageStats.get(stageId)!;
        stats.total++;
        if (ev.type === "stage.completed") stats.completed++;
        else stats.failed++;
      }
    }

    return {
      totalPipelines: total,
      successRate,
      avgDurationMs,
      totalTokensUsed: tokensUsed,
      stageStats,
    };
  }

  /**
   * 获取最近 N 个事件
   */
  getRecentEvents(n: number): AnalyticsEvent[] {
    return this.events.slice(-n);
  }

  /**
   * 清理旧事件（保留最近 N 条）
   */
  prune(maxEvents: number): number {
    if (this.events.length <= maxEvents) return 0;
    const removed = this.events.length - maxEvents;
    this.events = this.events.slice(-maxEvents);
    return removed;
  }

  private summarizeStages(stageRuns: StageRunRecord[]): StageResultSummary[] {
    return stageRuns.map((s) => ({
      instanceId: s.instanceId,
      stageId: s.stageId,
      status: s.status,
      attemptCount: s.attempt,
      durationMs:
        s.startedAt && s.completedAt ? Date.parse(s.completedAt) - Date.parse(s.startedAt) : null,
    }));
  }
}
