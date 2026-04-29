import type {
  PipelineRun,
  StageRunRecord,
} from "../../../../shared/features/agent-orchestrator/schemas";
import type { Orchestrator } from "../orchestrator";
import type { RunStore } from "../persistence/run-store";

import { ResumePromptBuilder } from "./resume-prompt-builder";
import { SandboxValidator } from "./sandbox-validator";

export interface RecoveryDecision {
  run: PipelineRun;
  stage: StageRunRecord;
  sandboxValid: boolean;
  recommendedAction: "restart" | "resume-with-context" | "skip-to-next" | "terminate";
  reason: string;
}

export class RecoveryOrchestrator {
  private sandboxValidator = new SandboxValidator();

  constructor(
    private runStore: RunStore,
    private orchestrator: Orchestrator,
  ) {}

  /**
   * 启动时扫描并恢复未完成的 Run
   */
  recoverIncompleteRuns(): RecoveryDecision[] {
    const incomplete = this.runStore.listRecoverable();
    const decisions: RecoveryDecision[] = [];

    for (const run of incomplete) {
      const stalledStages = run.stageRuns.filter(
        (s) => s.status === "running" || s.status === "paused" || s.status === "awaiting_user",
      );

      for (const stage of stalledStages) {
        const sandboxResult = this.sandboxValidator.validate(run.workspacePath, stage);

        let action: RecoveryDecision["recommendedAction"];
        if (!sandboxResult.valid) {
          action = "terminate";
        } else if (stage.status === "awaiting_user") {
          action = "resume-with-context";
        } else if (stage.status === "running") {
          action = "restart";
        } else {
          action = "resume-with-context";
        }

        decisions.push({
          run,
          stage,
          sandboxValid: sandboxResult.valid,
          recommendedAction: action,
          reason: this.getReason(stage, sandboxResult.valid),
        });
      }
    }

    return decisions;
  }

  /**
   * 执行恢复策略
   */
  resumeWithStrategy(
    runId: string,
    instanceId: string,
    strategy: "restart" | "resume-with-context" | "skip-to-next" | "terminate",
  ): boolean {
    switch (strategy) {
      case "restart":
        return this.orchestrator.retryStage(runId, instanceId);
      case "resume-with-context": {
        const run = this.runStore.get(runId);
        if (!run) return false;
        ResumePromptBuilder.buildResumePrompt(run, instanceId);
        return this.orchestrator.recoverRun(run) !== "";
      }
      case "skip-to-next":
        return this.orchestrator.skipStage(runId, instanceId);
      case "terminate":
        return this.orchestrator.cancelRun(runId);
    }
  }

  private getReason(stage: StageRunRecord, sandboxValid: boolean): string {
    if (!sandboxValid) return "Sandbox validation failed";
    switch (stage.status) {
      case "running":
        return `Stage was interrupted while running (attempt ${stage.attempt})`;
      case "awaiting_user":
        return "Stage is waiting for user approval";
      case "paused":
        return "Run was manually paused";
      default:
        return "Unknown interruption";
    }
  }
}
