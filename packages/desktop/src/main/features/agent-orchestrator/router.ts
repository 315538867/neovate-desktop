import { implement, ORPCError } from "@orpc/server";

import type { AppContext } from "../../router";
import type { Orchestrator } from "./orchestrator";

import { orchestratorContract } from "../../../shared/features/agent-orchestrator/contract";
import { APP_DATA_DIR } from "../../core/app-paths";
import { validateDAG } from "./dag/dag-validator";
import { EventStore } from "./persistence/event-store";
import { getTemplate, listTemplates } from "./templates/registry";

let orchestratorInstance: Orchestrator | null = null;

export function setOrchestrator(o: Orchestrator): void {
  orchestratorInstance = o;
}

function getOrchestrator(): Orchestrator {
  if (!orchestratorInstance) throw new Error("Orchestrator not initialized");
  return orchestratorInstance;
}

const os = implement({ orchestrator: orchestratorContract }).$context<AppContext>();

export const orchestratorRouter = os.orchestrator.router({
  // ==== 模板 ====
  listTemplates: os.orchestrator.listTemplates.handler(() => {
    return listTemplates() as unknown as any;
  }),

  getTemplate: os.orchestrator.getTemplate.handler(({ input }) => {
    const template = getTemplate(input.templateId);
    if (!template) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Template not found: ${input.templateId}`,
      });
    }
    return template as unknown as any;
  }),

  // ==== Run 启动 ====
  startRun: os.orchestrator.startRun.handler(async ({ input }) => {
    const template = getTemplate(input.templateId);
    if (!template) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Template not found: ${input.templateId}`,
      });
    }

    const orch = getOrchestrator();
    const budget = input.budget
      ? {
          maxTokens: input.budget.maxTokens,
          maxCost: input.budget.maxCost,
          maxDurationMs: input.budget.maxDurationMs,
          usedTokens: 0,
          usedCost: 0,
          usedDurationMs: 0,
        }
      : undefined;
    const runId = await orch.startRun(
      template,
      input.workspacePath,
      input.userPrompt,
      input.executorOverrides ?? template.defaultExecutorMap,
      budget,
    );
    return { runId };
  }),

  dryPlanRun: os.orchestrator.dryPlanRun.handler(async ({ input }) => {
    const template = getTemplate(input.templateId);
    if (!template) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Template not found: ${input.templateId}`,
      });
    }
    const validation = validateDAG(template);
    const estimatedStages = template.stages.map((s) => ({
      instanceId: s.instanceId,
      stageId: s.stageId,
      executorId: template.defaultExecutorMap[s.instanceId] ?? "unknown",
      isFanOut: !!s.fanOut,
      isFanIn: !!s.fanIn,
      userGate: s.userGate,
    }));
    return {
      estimatedStages,
      warnings: validation.errors,
      requiresProviderTokens: [],
    } as any;
  }),

  // ==== Run 控制 ====
  cancelRun: os.orchestrator.cancelRun.handler(({ input }) => {
    const success = getOrchestrator().cancelRun(input.runId);
    return { success };
  }),

  pauseRun: os.orchestrator.pauseRun.handler(({ input }) => {
    const success = getOrchestrator().pauseRun(input.runId);
    return { success };
  }),

  resumeRun: os.orchestrator.resumeRun.handler(({ input }) => {
    const success = getOrchestrator().resumeRun(input.runId);
    return { success };
  }),

  // ==== Run 查询 ====
  getRun: os.orchestrator.getRun.handler(({ input }) => {
    const run = getOrchestrator().getRun(input.runId);
    if (!run) {
      throw new ORPCError("NOT_FOUND", { message: `Run not found: ${input.runId}` });
    }
    return run as unknown as any;
  }),

  listRuns: os.orchestrator.listRuns.handler(({ input }) => {
    const items = getOrchestrator().listRuns({
      projectPath: input.projectPath,
    });
    return { items: items.slice(0, input.limit) as any, nextCursor: undefined };
  }),

  // ==== 流式订阅 ====
  subscribeRunEvents: os.orchestrator.subscribeRunEvents.handler(async function* ({ input }) {
    const store = new EventStore(APP_DATA_DIR);
    for await (const ev of store.tail(input.runId, input.sinceSeq ?? 0)) {
      yield ev as any;
    }
  }),

  // ==== Stage user_gate 操作 ====
  approveStage: os.orchestrator.approveStage.handler(({ input }) => {
    const success = getOrchestrator().approveStage(input.runId, input.instanceId);
    if (!success) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Cannot approve stage: ${input.instanceId}`,
      });
    }
    return { success };
  }),

  submitStageEdit: os.orchestrator.submitStageEdit.handler(async ({ input: _input }) => {
    // TODO: M5/M6 — 支持编辑 stage 输出
    return { success: true };
  }),

  retryStage: os.orchestrator.retryStage.handler(({ input }) => {
    const success = getOrchestrator().retryStage(input.runId, input.instanceId);
    if (!success) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Cannot retry stage: ${input.instanceId}`,
      });
    }
    return { success };
  }),

  skipStage: os.orchestrator.skipStage.handler(({ input }) => {
    const success = getOrchestrator().skipStage(input.runId, input.instanceId);
    if (!success) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Cannot skip stage: ${input.instanceId}`,
      });
    }
    return { success };
  }),

  // ==== 恢复 ====
  listRecoverableRuns: os.orchestrator.listRecoverableRuns.handler(
    async ({ context: _context }) => {
      // TODO: M5 — 实现恢复检测
      return [];
    },
  ),

  resumeRunWithStrategy: os.orchestrator.resumeRunWithStrategy.handler(
    async ({ input: _input }) => {
      // TODO: M5 — 实现恢复策略
      return { success: true };
    },
  ),

  // ==== Fan-out / Fan-in ====
  collapseFanOutToSerial: os.orchestrator.collapseFanOutToSerial.handler(
    async ({ input: _input }) => {
      // TODO: M6 — 实现 Fan-out 折叠
      return { success: true };
    },
  ),

  // ==== 改动应用 ====
  applyChangesToWorkspace: os.orchestrator.applyChangesToWorkspace.handler(
    async ({ input: _input }) => {
      // TODO: M5 — 实现工作区合并
      return { success: true, appliedFiles: [] };
    },
  ),

  rollbackChanges: os.orchestrator.rollbackChanges.handler(async ({ input: _input }) => {
    // TODO: M5 — 实现回滚
    return { success: true, rolledBackFiles: [] };
  }),

  // ==== 配置 ====
  getConfig: os.orchestrator.getConfig.handler(async ({ context: _context }) => {
    return {
      mode: "standard" as const,
      defaultExecutorMap: {
        A: "llm-only",
        B: "llm-only",
        C: "claude-code",
        D: "llm-only",
      },
      autoRunValidator: false,
      maxConcurrentRuns: 1,
    } as any;
  }),

  setConfig: os.orchestrator.setConfig.handler(async ({ context: _context }) => {
    return { success: true } as any;
  }),

  // ==== 观测 ====
  getRunDashboard: os.orchestrator.getRunDashboard.handler(async ({ input }) => {
    const run = getOrchestrator().getRun(input.runId);
    if (!run) {
      throw new ORPCError("NOT_FOUND", { message: `Run not found: ${input.runId}` });
    }
    const completedStages = run.stageRuns.filter(
      (s) => s.status === "completed" || s.status === "skipped",
    ).length;
    return {
      markdown: `## Run: ${run.runId}\nStatus: ${run.status}\nStages: ${completedStages}/${run.stageRuns.length}`,
      stats: {
        totalTokens: run.budget?.usedTokens ?? 0,
        totalCost: run.budget?.usedCost ?? 0,
        durationMs: run.budget?.usedDurationMs ?? 0,
        stageCount: run.stageRuns.length,
        completedStageCount: completedStages,
      },
    } as any;
  }),
});
