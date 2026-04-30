import type {
  AcceptanceReport,
  ImplementationResult,
  StageRunRecord,
} from "../../../../shared/features/agent-orchestrator/schemas";

/**
 * FanInAggregator 接口 — 每个聚合器处理特定类型的 fan-in 合并逻辑。
 */
export interface FanInAggregator {
  /** 聚合器唯一 ID，对应模板 fanIn.aggregatorId */
  readonly id: string;
  /** 显示名称 */
  readonly displayName: string;
  /**
   * 聚合多个子实例的输出为单一输出。
   * @param childOutputs 子实例的输出 (按 instanceId 索引)
   * @param childRecords 子实例的 StageRunRecord
   * @returns 聚合后的输出
   */
  aggregate(childOutputs: Map<string, unknown>, childRecords: StageRunRecord[]): unknown;
}

/**
 * merge-impl-results 聚合器 — 合并多个 ImplementationResult。
 *
 * 逻辑：
 * 1. 合并所有 filesChanged 列表（去重）
 * 2. 合并 subtaskLog
 * 3. 状态由最差子结果决定 (failed > partial > success)
 * 4. 收集所有 unresolvedIssues
 */
class MergeImplResultsAggregator implements FanInAggregator {
  readonly id = "merge-impl-results";
  readonly displayName = "Merge Implementation Results";

  aggregate(childOutputs: Map<string, unknown>, _childRecords: StageRunRecord[]): unknown {
    const results: ImplementationResult[] = [];

    for (const output of childOutputs.values()) {
      if (this.isImplementationResult(output)) {
        results.push(output);
      }
    }

    if (results.length === 0) {
      return {
        status: "failed",
        filesChanged: [],
        subtaskLog: [],
        unresolvedIssues: ["No implementation results to aggregate"],
        summary: "Fan-in aggregation failed: no valid outputs from child instances",
      };
    }

    // 合并文件变更（按 path 去重，保留最后的操作）
    const fileMap = new Map<string, ImplementationResult["filesChanged"][number]>();
    for (const r of results) {
      for (const fc of r.filesChanged) {
        fileMap.set(fc.path, fc);
      }
    }
    const filesChanged = Array.from(fileMap.values());

    // 合并 subtaskLog
    const subtaskLog = results.flatMap((r) => r.subtaskLog);

    // 收集 unresolvedIssues
    const unresolvedIssues = results.flatMap((r) => r.unresolvedIssues);

    // 状态派生
    const statuses = results.map((r) => r.status);
    const status = statuses.includes("failed")
      ? "failed"
      : statuses.includes("partial")
        ? "partial"
        : "success";

    const summary = [
      `Aggregated ${results.length} implementation results.`,
      `Total files changed: ${filesChanged.length}`,
      `Status: ${status}`,
      ...(unresolvedIssues.length > 0 ? [`${unresolvedIssues.length} unresolved issues`] : []),
    ].join("\n");

    return {
      status,
      filesChanged,
      subtaskLog,
      unresolvedIssues,
      summary,
    };
  }

  private isImplementationResult(v: unknown): v is ImplementationResult {
    return (
      typeof v === "object" &&
      v !== null &&
      "filesChanged" in v &&
      Array.isArray((v as ImplementationResult).filesChanged)
    );
  }
}

/**
 * merge-acceptance-reports 聚合器 — 合并多个 AcceptanceReport。
 */
class MergeAcceptanceReportsAggregator implements FanInAggregator {
  readonly id = "merge-acceptance-reports";
  readonly displayName = "Merge Acceptance Reports";

  aggregate(childOutputs: Map<string, unknown>, _childRecords: StageRunRecord[]): unknown {
    const reports: AcceptanceReport[] = [];

    for (const output of childOutputs.values()) {
      if (this.isAcceptanceReport(output)) {
        reports.push(output);
      }
    }

    if (reports.length === 0) {
      return {
        decision: "rejected",
        score: 0,
        defects: [
          {
            severity: "blocker" as const,
            problem: "No acceptance reports to aggregate",
            fixHint: "",
          },
        ],
        matchesArchitecture: false,
        followups: [],
      };
    }

    // 合并 defects
    const defects = reports.flatMap((r) => r.defects);

    // 合并 followups
    const followups = reports.flatMap((r) => r.followups);

    // 决策派生
    const decisions = reports.map((r) => r.decision);
    const decision = decisions.includes("rejected")
      ? "rejected"
      : decisions.includes("accepted_with_followups")
        ? "accepted_with_followups"
        : "accepted";

    // 平均分
    const avgScore = Math.round(reports.reduce((sum, r) => sum + r.score, 0) / reports.length);

    // matchesArchitecture: 全部匹配才算
    const matchesArchitecture = reports.every((r) => r.matchesArchitecture);

    return {
      decision,
      score: avgScore,
      defects,
      matchesArchitecture,
      followups,
    };
  }

  private isAcceptanceReport(v: unknown): v is AcceptanceReport {
    return typeof v === "object" && v !== null && "defects" in v && "matchesArchitecture" in v;
  }
}

/**
 * FanInAggregatorRegistry — 管理所有 fan-in 聚合器。
 */
export class FanInAggregatorRegistry {
  private aggregators = new Map<string, FanInAggregator>();

  constructor() {
    this.register(new MergeImplResultsAggregator());
    this.register(new MergeAcceptanceReportsAggregator());
  }

  register(aggregator: FanInAggregator): void {
    this.aggregators.set(aggregator.id, aggregator);
  }

  get(id: string): FanInAggregator | undefined {
    return this.aggregators.get(id);
  }

  list(): FanInAggregator[] {
    return Array.from(this.aggregators.values());
  }

  /**
   * 执行 fan-in 聚合：收集子实例输出，调用聚合器，返回合并结果。
   */
  aggregate(aggregatorId: string, childRecords: StageRunRecord[]): unknown | null {
    const aggregator = this.get(aggregatorId);
    if (!aggregator) return null;

    const childOutputs = new Map<string, unknown>();
    for (const record of childRecords) {
      if (record.output !== undefined) {
        childOutputs.set(record.instanceId, record.output);
      }
    }

    return aggregator.aggregate(childOutputs, childRecords);
  }
}
