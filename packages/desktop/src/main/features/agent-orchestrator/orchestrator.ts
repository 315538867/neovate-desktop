import { randomUUID } from "node:crypto";

import type {
  PipelineEvent,
  PipelineRun,
  PipelineTemplate,
  StageError,
  StageRunRecord,
  StageRunStatus,
} from "../../../shared/features/agent-orchestrator/schemas";

import { deriveRunStatus } from "../../../shared/features/agent-orchestrator/schemas";
import { validateDAG } from "./dag/dag-validator";
import { classifyError } from "./errors/error-classifier";
import { getExecutor } from "./executors/registry";
import { CheckpointManager } from "./persistence/checkpoint-manager";
import { EventStore } from "./persistence/event-store";
import { PartialOutputStore } from "./persistence/partial-output-store";
import { RunStore } from "./persistence/run-store";
import { getStage } from "./stages/registry";
import { getTemplate } from "./templates/registry";

export type OrchestratorDeps = {
  runStore: RunStore;
  eventStore: EventStore;
  partialOutputStore: PartialOutputStore;
  checkpointManager: CheckpointManager;
};

interface ActiveRun {
  run: PipelineRun;
  abortController: AbortController;
  tickTimer?: ReturnType<typeof setInterval>;
}

interface ActiveStage {
  abortController: AbortController;
  startTime: number;
}

export class Orchestrator {
  private activeRuns = new Map<string, ActiveRun>();
  private activeStages = new Map<string, ActiveStage>();
  private deps: OrchestratorDeps;
  private tickInterval = 1000; // 1s
  private emitEvent: ((event: PipelineEvent) => void) | null = null;

  constructor(deps: OrchestratorDeps) {
    this.deps = deps;
  }

  onEvent(cb: (event: PipelineEvent) => void): void {
    this.emitEvent = cb;
  }

  // ==== 生命周期 ====

  async startRun(
    template: PipelineTemplate,
    workspacePath: string,
    userPrompt: string,
    executorMap: Record<string, string>,
    budget?: PipelineRun["budget"],
  ): Promise<string> {
    const validation = validateDAG(template);
    if (!validation.ok) {
      throw new Error(`Invalid template DAG: ${validation.errors.join(", ")}`);
    }

    const runId = randomUUID();
    const now = new Date().toISOString();

    const stageRuns: StageRunRecord[] = template.stages.map((s) => ({
      instanceId: s.instanceId,
      stageId: s.stageId,
      executorId:
        executorMap[s.instanceId] ?? template.defaultExecutorMap[s.instanceId] ?? "llm-only",
      status: "pending" as StageRunStatus,
      input: undefined,
      errors: [],
      attempt: 0,
    }));

    const run: PipelineRun = {
      runId,
      templateId: template.id,
      workspacePath,
      userPrompt,
      stageRuns,
      status: "init",
      budget,
      executorMap,
      createdAt: now,
      ownerPid: process.pid,
      ownerStartedAt: now,
    };

    this.deps.runStore.save(run);
    this.publish({
      type: "run.started",
      runId,
      templateId: template.id,
      stageCount: stageRuns.length,
    });

    // Start tick
    const abortController = new AbortController();
    const tickTimer = setInterval(() => {
      if (abortController.signal.aborted) return;
      this.tick(runId);
    }, this.tickInterval);

    this.activeRuns.set(runId, {
      run,
      abortController,
      tickTimer,
    });

    // First tick immediately
    this.tick(runId);

    return runId;
  }

  private tick(runId: string): void {
    const active = this.activeRuns.get(runId);
    if (!active) return;

    const { run, abortController } = active;

    if (abortController.signal.aborted) return;

    // 1. 派生状态
    run.status = deriveRunStatus(run.stageRuns);

    // 2. 心跳
    run.lastHeartbeatAt = new Date().toISOString();
    this.deps.runStore.save(run);

    // 3. 终态检查
    if (["completed", "failed", "cancelled"].includes(run.status)) {
      this.stopRun(runId, run);
      return;
    }

    // 4. 预算检查
    if (run.budget) {
      if (
        (run.budget.maxDurationMs && run.budget.usedDurationMs >= run.budget.maxDurationMs) ||
        (run.budget.maxTokens && run.budget.usedTokens >= run.budget.maxTokens)
      ) {
        run.status = "failed";
        run.failureReason = "budget_exceeded";
        this.deps.runStore.save(run);
        this.publish({ type: "run.budget_exceeded", runId });
        this.stopRun(runId, run);
        return;
      }
    }

    // 5. Stage 超时检查
    this.checkStageTimeouts(run);

    // 6. DAG 调度 — 找到所有依赖已完成的 pending stages
    for (const stageRun of run.stageRuns) {
      if (stageRun.status !== "pending") continue;

      const template = getTemplate(run.templateId);
      if (!template) continue;

      const templateStage = template.stages.find((s) => s.instanceId === stageRun.instanceId);
      if (!templateStage) continue;

      if (this.allDepsCompleted(stageRun.instanceId, run.stageRuns, template)) {
        // user_gate: "before" — 等待用户批准
        if (templateStage.userGate === "before") {
          stageRun.status = "awaiting_user";
          this.deps.runStore.save(run);
          this.publish({
            type: "stage.awaiting_user",
            runId,
            stageInstanceId: stageRun.instanceId,
          });
          continue;
        }

        this.startStage(run, stageRun, templateStage);
      }
    }
  }

  private stopRun(runId: string, run: PipelineRun): void {
    const active = this.activeRuns.get(runId);
    if (!active) return;

    run.completedAt = new Date().toISOString();
    this.deps.runStore.save(run);

    if (active.tickTimer) clearInterval(active.tickTimer);
    active.abortController.abort();
    this.activeRuns.delete(runId);

    this.publish({ type: "run." + run.status, runId });
  }

  // ==== DAG 依赖 ====

  private allDepsCompleted(
    instanceId: string,
    stageRuns: StageRunRecord[],
    template: PipelineTemplate,
  ): boolean {
    const stage = template.stages.find((s) => s.instanceId === instanceId);
    if (!stage || stage.dependsOn.length === 0) return true;

    return stage.dependsOn.every((depId) => {
      const depRun = stageRuns.find((s) => s.instanceId === depId);
      return depRun && (depRun.status === "completed" || depRun.status === "skipped");
    });
  }

  // ==== Stage 管理 ====

  private async startStage(
    run: PipelineRun,
    stageRun: StageRunRecord,
    templateStage: PipelineTemplate["stages"][number],
  ): Promise<void> {
    const executor = getExecutor(stageRun.executorId);
    if (!executor) {
      stageRun.status = "failed";
      stageRun.fatalError = this.makeError(
        "capability_mismatch",
        `Executor not found: ${stageRun.executorId}`,
      );
      this.deps.runStore.save(run);
      return;
    }

    const stagePlugin = getStage(templateStage.stageId);
    const abortController = new AbortController();
    const startTime = Date.now();

    stageRun.status = "running";
    stageRun.startedAt = new Date().toISOString();
    stageRun.attempt += 1;

    // Checkpoint
    this.deps.checkpointManager.save(run.runId, stageRun.instanceId, {
      sandboxPath: run.workspacePath,
      sandboxValidationHash: "",
      stageInputDigest: "",
      startedAt: stageRun.startedAt,
    });

    this.deps.runStore.save(run);
    this.publish({ type: "stage.started", runId: run.runId, stageInstanceId: stageRun.instanceId });

    const stageKey = `${run.runId}:${stageRun.instanceId}`;
    this.activeStages.set(stageKey, { abortController, startTime });

    try {
      // Build input
      const upstreamOutputs = this.collectUpstreamOutputs(stageRun.instanceId, run);
      const stageInput = stagePlugin
        ? stagePlugin.buildInput(
            {
              run,
              taskInput: { userPrompt: run.userPrompt, workspacePath: run.workspacePath },
              workspacePath: run.workspacePath,
              config: {
                mode: "orchestrated",
                defaultExecutorMap: run.executorMap,
                autoRunValidator: false,
                maxConcurrentRuns: 1,
              },
            },
            upstreamOutputs,
          )
        : run.userPrompt;

      const systemPrompt = stagePlugin?.defaultSystemPrompt ?? "";
      const userPrompt =
        typeof stageInput === "string" ? stageInput : JSON.stringify(stageInput, null, 2);

      // Execute
      let structuredOutput: unknown;

      for await (const ev of executor.execute({
        systemPrompt,
        userPrompt,
        workspacePath: run.workspacePath,
        abortSignal: abortController.signal,
        outputSchema: stagePlugin?.outputSchema,
      })) {
        switch (ev.type) {
          case "text":
            this.deps.partialOutputStore.write(run.runId, stageRun.instanceId, ev.delta);
            break;

          case "tool-call":
            this.publish({
              type: "stage.tool_call",
              runId: run.runId,
              stageInstanceId: stageRun.instanceId,
              tool: ev.tool,
              args: ev.args,
              callId: ev.callId,
            });
            break;

          case "tool-result":
            this.publish({
              type: "stage.tool_result",
              runId: run.runId,
              stageInstanceId: stageRun.instanceId,
              callId: ev.callId,
              result: ev.result,
              isError: ev.isError,
            });
            break;

          case "usage":
            if (run.budget) {
              run.budget.usedTokens += ev.tokens;
            }
            break;

          case "structured-output":
            structuredOutput = ev.data;
            break;

          case "done":
            stageRun.status = "completed";
            stageRun.completedAt = new Date().toISOString();
            stageRun.output = structuredOutput ?? {};

            // user_gate: "after" — 等待用户确认
            if (templateStage.userGate === "after") {
              stageRun.status = "awaiting_user";
            }

            this.deps.runStore.save(run);
            this.deps.partialOutputStore.flush(run.runId, stageRun.instanceId);
            this.publish({
              type: "stage.completed",
              runId: run.runId,
              stageInstanceId: stageRun.instanceId,
            });
            break;

          case "error":
            stageRun.status = "failed";
            stageRun.errors.push({
              attempt: stageRun.attempt,
              timestamp: new Date().toISOString(),
              level: ev.level,
              code: ev.code as StageError["code"],
              httpStatus: ev.httpStatus,
              providerMessage: ev.message,
            });
            this.deps.runStore.save(run);
            this.publish({
              type: "stage.failed",
              runId: run.runId,
              stageInstanceId: stageRun.instanceId,
            });
            break;
        }
      }
    } catch (err) {
      stageRun.status = "failed";
      const classified = classifyError(err);
      stageRun.errors.push({
        attempt: stageRun.attempt,
        timestamp: new Date().toISOString(),
        level: classified.level,
        code: classified.code as StageError["code"],
        httpStatus: classified.httpStatus,
        providerMessage: String(err),
      });
      this.deps.runStore.save(run);
      this.publish({
        type: "stage.failed",
        runId: run.runId,
        stageInstanceId: stageRun.instanceId,
      });
    } finally {
      this.activeStages.delete(stageKey);
    }
  }

  private collectUpstreamOutputs(instanceId: string, run: PipelineRun): Map<string, unknown> {
    const template = getTemplate(run.templateId);
    if (!template) return new Map();

    const stage = template.stages.find((s) => s.instanceId === instanceId);
    if (!stage) return new Map();

    const outputs = new Map<string, unknown>();
    for (const depId of stage.dependsOn) {
      const depRun = run.stageRuns.find((s) => s.instanceId === depId);
      if (depRun?.output) {
        outputs.set(depId, depRun.output);
      }
    }
    return outputs;
  }

  private checkStageTimeouts(run: PipelineRun): void {
    const template = getTemplate(run.templateId);
    if (!template) return;

    for (const stageRun of run.stageRuns) {
      if (stageRun.status !== "running") continue;

      const templateStage = template.stages.find((s) => s.instanceId === stageRun.instanceId);
      if (!templateStage?.timeoutMs) continue;

      const stageKey = `${run.runId}:${stageRun.instanceId}`;
      const active = this.activeStages.get(stageKey);
      if (!active) continue;

      const elapsed = Date.now() - active.startTime;
      if (elapsed > templateStage.timeoutMs) {
        stageRun.status = "failed";
        stageRun.fatalError = this.makeError(
          "timeout",
          `Stage timed out after ${templateStage.timeoutMs}ms`,
        );
        active.abortController.abort();
        this.activeStages.delete(stageKey);
        this.deps.runStore.save(run);
        this.publish({
          type: "stage.timeout",
          runId: run.runId,
          stageInstanceId: stageRun.instanceId,
        });
      }
    }
  }

  // ==== 控制操作 ====

  cancelRun(runId: string): boolean {
    const active = this.activeRuns.get(runId);
    if (!active) return false;

    active.run.status = "cancelled";
    active.abortController.abort();
    this.stopRun(runId, active.run);

    // Abort all active stages
    for (const [key, stage] of this.activeStages) {
      if (key.startsWith(runId + ":")) {
        stage.abortController.abort();
        this.activeStages.delete(key);
      }
    }

    return true;
  }

  pauseRun(runId: string): boolean {
    const active = this.activeRuns.get(runId);
    if (!active) return false;

    active.run.status = "paused";
    active.run.pausedAt = new Date().toISOString();
    if (active.tickTimer) clearInterval(active.tickTimer);
    this.deps.runStore.save(active.run);
    this.publish({ type: "run.paused", runId });
    return true;
  }

  resumeRun(runId: string): boolean {
    const active = this.activeRuns.get(runId);
    if (!active || active.run.status !== "paused") return false;

    active.run.status = "running";
    active.tickTimer = setInterval(() => this.tick(runId), this.tickInterval);
    this.deps.runStore.save(active.run);
    this.publish({ type: "run.resumed", runId });

    // Tick immediately
    this.tick(runId);
    return true;
  }

  approveStage(runId: string, instanceId: string): boolean {
    const active = this.activeRuns.get(runId);
    if (!active) return false;

    const stageRun = active.run.stageRuns.find((s) => s.instanceId === instanceId);
    if (!stageRun || stageRun.status !== "awaiting_user") return false;

    stageRun.status = "completed";
    this.deps.runStore.save(active.run);
    this.publish({ type: "stage.approved", runId, stageInstanceId: instanceId });

    // Tick to continue
    this.tick(runId);
    return true;
  }

  retryStage(runId: string, instanceId: string): boolean {
    const active = this.activeRuns.get(runId);
    if (!active) return false;

    const stageRun = active.run.stageRuns.find((s) => s.instanceId === instanceId);
    if (!stageRun || stageRun.status !== "failed") return false;

    stageRun.status = "pending";
    stageRun.output = undefined;
    stageRun.errors = [];
    stageRun.completedAt = undefined;
    this.deps.runStore.save(active.run);
    this.publish({ type: "stage.retry", runId, stageInstanceId: instanceId });

    this.tick(runId);
    return true;
  }

  skipStage(runId: string, instanceId: string): boolean {
    const active = this.activeRuns.get(runId);
    if (!active) return false;

    const stageRun = active.run.stageRuns.find((s) => s.instanceId === instanceId);
    if (!stageRun) return false;

    stageRun.status = "skipped";
    stageRun.completedAt = new Date().toISOString();
    this.deps.runStore.save(active.run);
    this.publish({ type: "stage.skipped", runId, stageInstanceId: instanceId });

    this.tick(runId);
    return true;
  }

  // ==== 查询 ====

  getRun(runId: string): PipelineRun | undefined {
    const active = this.activeRuns.get(runId);
    if (active) return active.run;
    return this.deps.runStore.get(runId);
  }

  listRuns(filter?: { projectPath?: string }): PipelineRun[] {
    return this.deps.runStore.list(filter);
  }

  // ==== 事件 ====

  private publish(event: Record<string, unknown>): void {
    const pipelineEvent: PipelineEvent = {
      type: event.type as string,
      timestamp: new Date().toISOString(),
      runId: event.runId as string,
      stageInstanceId: event.stageInstanceId as string | undefined,
      payload: event,
    };
    this.deps.eventStore.append(pipelineEvent.runId, pipelineEvent);
    this.emitEvent?.(pipelineEvent);
  }

  // ==== Helper ====

  private makeError(code: StageError["code"], message: string): StageError {
    return {
      attempt: 0,
      timestamp: new Date().toISOString(),
      level: "L2",
      code,
      providerMessage: message,
    };
  }

  /** 恢复中断的 run */
  recoverRun(run: PipelineRun): string {
    if (!this.activeRuns.has(run.runId)) {
      const abortController = new AbortController();
      const tickTimer = setInterval(() => this.tick(run.runId), this.tickInterval);
      this.activeRuns.set(run.runId, { run, abortController, tickTimer });
      this.tick(run.runId);
    }
    return run.runId;
  }
}
