import { implement, ORPCError } from "@orpc/server";

import type { AppContext } from "../../router";
import type { Orchestrator } from "./orchestrator";

import { orchestratorContract } from "../../../shared/features/agent-orchestrator/contract";
import { APP_DATA_DIR } from "../../core/app-paths";
import { validateDAG } from "./dag/dag-validator";
import { FanOutExpander } from "./fanout/fanout-expander";
import { DashboardGenerator } from "./observability/dashboard";
import { EventStore } from "./persistence/event-store";
import { WorktreeManager } from "./sandbox/worktree-manager";
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

  submitStageEdit: os.orchestrator.submitStageEdit.handler(async ({ input }) => {
    const orch = getOrchestrator();
    const run = orch.getRun(input.runId);
    if (!run) {
      throw new ORPCError("NOT_FOUND", { message: `Run not found: ${input.runId}` });
    }
    const stageRun = run.stageRuns.find((s) => s.instanceId === input.instanceId);
    if (!stageRun) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Stage not found: ${input.instanceId}`,
      });
    }
    // 允许用户编辑 stage 输出（例如修正架构设计）
    stageRun.output = input.editedOutput;
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
    async () => {
      const orch = getOrchestrator();
      const allRuns = orch.listRuns();
      const recoverable: Array<{
        run: unknown;
        stage: unknown;
        sandboxValid: boolean;
        sandboxValidationDetails: Array<{ check: string; passed: boolean; detail?: string }>;
        recommendedAction: "smart-resume" | "redo" | "skip" | "terminate";
      }> = [];

      for (const run of allRuns) {
        // 查找 interrupted/stalled 的 stage
        const interruptedStage = run.stageRuns.find(
          (s) =>
            s.status === "interrupted_graceful" ||
            s.status === "interrupted_crashed" ||
            s.status === "stalled",
        );
        if (!interruptedStage) continue;

        // 检查是否有 checkpoint
        const hasCheckpoint = !!interruptedStage.checkpoint;

        recoverable.push({
          run: { runId: run.runId, templateId: run.templateId, status: run.status },
          stage: {
            instanceId: interruptedStage.instanceId,
            stageId: interruptedStage.stageId,
            status: interruptedStage.status,
          },
          sandboxValid: hasCheckpoint,
          sandboxValidationDetails: [
            { check: "checkpoint_exists", passed: hasCheckpoint, detail: hasCheckpoint ? "Checkpoint available for resume" : "No checkpoint found" },
          ],
          recommendedAction: hasCheckpoint ? "smart-resume" : "redo",
        });
      }

      return recoverable;
    },
  ),

  resumeRunWithStrategy: os.orchestrator.resumeRunWithStrategy.handler(
    async ({ input }) => {
      const orch = getOrchestrator();
      const run = orch.getRun(input.runId);
      if (!run) {
        throw new ORPCError("NOT_FOUND", { message: `Run not found: ${input.runId}` });
      }

      switch (input.strategy) {
        case "restart": {
          // 将 interrupted stage 重置为 pending
          const stage = run.stageRuns.find((s) => s.instanceId === input.instanceId);
          if (stage) {
            stage.status = "pending";
            stage.output = undefined;
            stage.errors = [];
            stage.attempt = 0;
          }
          orch.recoverRun(run);
          break;
        }
        case "resume-with-context": {
          // 恢复执行，保留部分输出作为上下文
          const stage = run.stageRuns.find((s) => s.instanceId === input.instanceId);
          if (stage) {
            stage.status = "pending";
            // 保留 output 作为上下文
          }
          orch.recoverRun(run);
          break;
        }
        case "skip-to-next": {
          const skipped = orch.skipStage(input.runId, input.instanceId);
          if (!skipped) {
            throw new ORPCError("BAD_REQUEST", {
              message: `Cannot skip stage: ${input.instanceId}`,
            });
          }
          break;
        }
        case "terminate": {
          orch.cancelRun(input.runId);
          break;
        }
      }

      return { success: true };
    },
  ),

  // ==== Fan-out / Fan-in ====
  collapseFanOutToSerial: os.orchestrator.collapseFanOutToSerial.handler(
    async ({ input }) => {
      const orch = getOrchestrator();
      const run = orch.getRun(input.runId);
      if (!run) {
        throw new ORPCError("NOT_FOUND", { message: `Run not found: ${input.runId}` });
      }

      const template = getTemplate(run.templateId);
      if (!template) {
        throw new ORPCError("BAD_REQUEST", { message: `Template not found: ${run.templateId}` });
      }

      // 找到父 stage (fanOut 源)
      const parentStage = run.stageRuns.find(
        (s) => s.instanceId === input.fanOutInstanceId,
      );
      if (!parentStage) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Fan-out parent stage not found: ${input.fanOutInstanceId}`,
        });
      }

      // 找到所有子实例
      const childInstances = run.stageRuns.filter(
        (s) =>
          s.fanOutParentInstanceId === input.fanOutInstanceId &&
          s.status !== "completed" &&
          s.status !== "skipped",
      );

      // 跳过所有未完成的子实例
      for (const child of childInstances) {
        child.status = "skipped";
        child.completedAt = new Date().toISOString();
      }

      // 将父 stage 状态重置（如果还在等待子实例）
      if (parentStage.status === "running" || parentStage.status === "pending") {
        parentStage.status = "pending";
        parentStage.output = undefined;
      }

      return { success: true };
    },
  ),

  // ==== 改动应用 ====
  applyChangesToWorkspace: os.orchestrator.applyChangesToWorkspace.handler(
    async ({ input }) => {
      const orch = getOrchestrator();
      const run = orch.getRun(input.runId);
      if (!run) {
        throw new ORPCError("NOT_FOUND", { message: `Run not found: ${input.runId}` });
      }

      const wm = new WorktreeManager(APP_DATA_DIR);
      const result = wm.applyChangesToWorkspace(
        input.runId,
        run.workspacePath,
        input.mode,
      );

      return result;
    },
  ),

  rollbackChanges: os.orchestrator.rollbackChanges.handler(async ({ input }) => {
    const orch = getOrchestrator();
    const run = orch.getRun(input.runId);
    if (!run) {
      throw new ORPCError("NOT_FOUND", { message: `Run not found: ${input.runId}` });
    }

    const wm = new WorktreeManager(APP_DATA_DIR);
    const result = wm.rollbackChanges(input.runId, run.workspacePath);

    return result;
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

    const generator = new DashboardGenerator();
    const markdown = generator.generateMarkdown(run);
    const stats = generator.computeStats(run);

    return {
      markdown,
      stats: {
        totalTokens: stats.totalTokens,
        totalCost: stats.totalCost,
        durationMs: stats.durationMs,
        stageCount: stats.stageCount,
        completedStageCount: stats.completedStageCount,
      },
    } as any;
  }),
});
