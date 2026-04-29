import { eventIterator, oc, type } from "@orpc/contract";
import { z } from "zod";

import type { PipelineRun, PipelineEvent, PipelineTemplate } from "./schemas";

export const orchestratorContract = {
  // ==== 模板 ====
  listTemplates: oc.output(type<PipelineTemplate[]>()),

  getTemplate: oc.input(z.object({ templateId: z.string() })).output(type<PipelineTemplate>()),

  // ==== Run 启动 / 控制 ====
  startRun: oc
    .input(
      z.object({
        templateId: z.string(),
        workspacePath: z.string(),
        userPrompt: z.string(),
        executorOverrides: z.record(z.string(), z.string()).optional(),
        budget: z
          .object({
            maxTokens: z.number().int().positive().optional(),
            maxCost: z.number().positive().optional(),
            maxDurationMs: z.number().int().positive().optional(),
          })
          .optional(),
      }),
    )
    .output(z.object({ runId: z.string() })),

  dryPlanRun: oc
    .input(
      z.object({
        templateId: z.string(),
        workspacePath: z.string(),
        userPrompt: z.string(),
      }),
    )
    .output(
      z.object({
        estimatedStages: z.array(
          z.object({
            instanceId: z.string(),
            stageId: z.string(),
            executorId: z.string(),
            isFanOut: z.boolean(),
            isFanIn: z.boolean(),
            userGate: z.enum(["before", "after", "never"]),
          }),
        ),
        warnings: z.array(z.string()),
        requiresProviderTokens: z.array(z.string()),
      }),
    ),

  cancelRun: oc.input(z.object({ runId: z.string() })).output(z.object({ success: z.boolean() })),

  pauseRun: oc.input(z.object({ runId: z.string() })).output(z.object({ success: z.boolean() })),

  resumeRun: oc.input(z.object({ runId: z.string() })).output(z.object({ success: z.boolean() })),

  // ==== Run 查询 ====
  getRun: oc.input(z.object({ runId: z.string() })).output(type<PipelineRun>()),

  listRuns: oc
    .input(
      z.object({
        projectPath: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
        cursor: z.string().optional(),
      }),
    )
    .output(
      z.object({
        items: z.array(z.any()),
        nextCursor: z.string().optional(),
      }),
    ),

  // ==== 流式订阅 ====
  subscribeRunEvents: oc
    .input(
      z.object({
        runId: z.string(),
        sinceSeq: z.number().int().min(0).optional(),
      }),
    )
    .output(eventIterator(type<PipelineEvent>())),

  // ==== Stage user_gate 操作 ====
  approveStage: oc
    .input(
      z.object({
        runId: z.string(),
        instanceId: z.string(),
      }),
    )
    .output(z.object({ success: z.boolean() })),

  submitStageEdit: oc
    .input(
      z.object({
        runId: z.string(),
        instanceId: z.string(),
        editedOutput: z.unknown(),
      }),
    )
    .output(z.object({ success: z.boolean() })),

  retryStage: oc
    .input(
      z.object({
        runId: z.string(),
        instanceId: z.string(),
        feedback: z.string().optional(),
        forceFreshSession: z.boolean().default(false),
      }),
    )
    .output(z.object({ success: z.boolean() })),

  skipStage: oc
    .input(
      z.object({
        runId: z.string(),
        instanceId: z.string(),
      }),
    )
    .output(z.object({ success: z.boolean() })),

  // ==== 恢复 ====
  listRecoverableRuns: oc.output(
    z.array(
      z.object({
        run: z.any(),
        stage: z.any(),
        sandboxValid: z.boolean(),
        sandboxValidationDetails: z.array(
          z.object({
            check: z.string(),
            passed: z.boolean(),
            detail: z.string().optional(),
          }),
        ),
        recommendedAction: z.enum(["smart-resume", "redo", "skip", "terminate"]),
      }),
    ),
  ),

  resumeRunWithStrategy: oc
    .input(
      z.object({
        runId: z.string(),
        instanceId: z.string(),
        strategy: z.enum(["restart", "resume-with-context", "skip-to-next", "terminate"]),
      }),
    )
    .output(z.object({ success: z.boolean() })),

  // ==== Fan-out 控制 ====
  collapseFanOutToSerial: oc
    .input(
      z.object({
        runId: z.string(),
        fanOutInstanceId: z.string(),
      }),
    )
    .output(z.object({ success: z.boolean() })),

  // ==== 改动应用 ====
  applyChangesToWorkspace: oc
    .input(
      z.object({
        runId: z.string(),
        mode: z.enum(["merge-to-main", "apply-as-patch"]).default("merge-to-main"),
      }),
    )
    .output(
      z.object({
        success: z.boolean(),
        appliedFiles: z.array(z.string()),
        conflicts: z
          .array(
            z.object({
              file: z.string(),
              resolution: z.enum(["ours", "theirs", "manual"]),
            }),
          )
          .optional(),
      }),
    ),

  rollbackChanges: oc.input(z.object({ runId: z.string() })).output(
    z.object({
      success: z.boolean(),
      rolledBackFiles: z.array(z.string()),
    }),
  ),

  // ==== 配置 ====
  getConfig: oc.input(z.object({ workspacePath: z.string().optional() })).output(
    z.object({
      mode: z.enum(["standard", "orchestrated"]).default("standard"),
      defaultExecutorMap: z.record(z.string(), z.string()),
      autoRunValidator: z.boolean().default(false),
      maxConcurrentRuns: z.number().int().min(1).default(1),
    }),
  ),

  setConfig: oc
    .input(
      z.object({
        workspacePath: z.string().optional(),
        patch: z.object({
          mode: z.enum(["standard", "orchestrated"]).optional(),
          defaultExecutorMap: z.record(z.string(), z.string()).optional(),
          autoRunValidator: z.boolean().optional(),
          maxConcurrentRuns: z.number().int().min(1).optional(),
        }),
      }),
    )
    .output(z.object({ success: z.boolean() })),

  // ==== 观测 ====
  getRunDashboard: oc.input(z.object({ runId: z.string() })).output(
    z.object({
      markdown: z.string(),
      stats: z.object({
        totalTokens: z.number(),
        totalCost: z.number(),
        durationMs: z.number(),
        stageCount: z.number(),
        completedStageCount: z.number(),
      }),
    }),
  ),
};
