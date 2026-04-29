import { implement, ORPCError } from "@orpc/server";

import type { AppContext } from "../../router";

import { orchestratorContract } from "../../../shared/features/agent-orchestrator/contract";
import { validateDAG } from "./dag/dag-validator";
import { listTemplates, getTemplate } from "./templates/registry";

const os = implement({ orchestrator: orchestratorContract }).$context<AppContext>();

export const orchestratorRouter = os.orchestrator.router({
  // ==== 模板 ====
  listTemplates: os.orchestrator.listTemplates.handler(() => {
    const templates = listTemplates();
    return templates as unknown as any;
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

  // ==== Run 启动 / 控制 ====
  startRun: os.orchestrator.startRun.handler(async (_input) => {
    // M1: 占位实现，M3 补完
    throw new Error("Not implemented: startRun");
  }),

  dryPlanRun: os.orchestrator.dryPlanRun.handler(async ({ input }) => {
    const template = getTemplate(input.templateId);
    if (!template) {
      throw new Error(`Template not found: ${input.templateId}`);
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

  cancelRun: os.orchestrator.cancelRun.handler(async (_input) => {
    throw new Error("Not implemented: cancelRun");
  }),

  pauseRun: os.orchestrator.pauseRun.handler(async (_input) => {
    throw new Error("Not implemented: pauseRun");
  }),

  resumeRun: os.orchestrator.resumeRun.handler(async (_input) => {
    throw new Error("Not implemented: resumeRun");
  }),

  // ==== Run 查询 ====
  getRun: os.orchestrator.getRun.handler(async (_input) => {
    throw new Error("Not implemented: getRun");
  }),

  listRuns: os.orchestrator.listRuns.handler(async (_input) => {
    return { items: [] } as any;
  }),

  // ==== 流式订阅 ====
  subscribeRunEvents: os.orchestrator.subscribeRunEvents.handler(async function* (_input) {
    // M1: 空实现
    yield* [];
  }),

  // ==== Stage user_gate 操作 ====
  approveStage: os.orchestrator.approveStage.handler(async (_input) => {
    throw new Error("Not implemented: approveStage");
  }),

  submitStageEdit: os.orchestrator.submitStageEdit.handler(async (_input) => {
    throw new Error("Not implemented: submitStageEdit");
  }),

  retryStage: os.orchestrator.retryStage.handler(async (_input) => {
    throw new Error("Not implemented: retryStage");
  }),

  skipStage: os.orchestrator.skipStage.handler(async (_input) => {
    throw new Error("Not implemented: skipStage");
  }),

  // ==== 恢复 ====
  listRecoverableRuns: os.orchestrator.listRecoverableRuns.handler(async () => {
    return [] as any;
  }),

  resumeRunWithStrategy: os.orchestrator.resumeRunWithStrategy.handler(async (_input) => {
    throw new Error("Not implemented: resumeRunWithStrategy");
  }),

  // ==== Fan-out 控制 ====
  collapseFanOutToSerial: os.orchestrator.collapseFanOutToSerial.handler(async (_input) => {
    throw new Error("Not implemented: collapseFanOutToSerial");
  }),

  // ==== 改动应用 ====
  applyChangesToWorkspace: os.orchestrator.applyChangesToWorkspace.handler(async (_input) => {
    throw new Error("Not implemented: applyChangesToWorkspace");
  }),

  rollbackChanges: os.orchestrator.rollbackChanges.handler(async (_input) => {
    throw new Error("Not implemented: rollbackChanges");
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
  getRunDashboard: os.orchestrator.getRunDashboard.handler(async (_input) => {
    throw new Error("Not implemented: getRunDashboard");
  }),
});
