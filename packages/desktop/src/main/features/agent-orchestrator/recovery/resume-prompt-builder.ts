import type {
  PipelineRun,
  StageRunRecord,
} from "../../../../shared/features/agent-orchestrator/schemas";

export class ResumePromptBuilder {
  /**
   * 为中断的 stage 构建续跑 prompt
   */
  static buildResumePrompt(
    run: PipelineRun,
    instanceId: string,
  ): {
    systemPrompt: string;
    userPrompt: string;
    context: unknown;
  } {
    const stage = run.stageRuns.find((s) => s.instanceId === instanceId);
    if (!stage) {
      return {
        systemPrompt: "",
        userPrompt: "Continue from where you left off.",
        context: {},
      };
    }

    const lastError = stage.errors[stage.errors.length - 1];
    const hasPartial = stage.partialOutput != null;

    const systemPrompt = [
      "You are resuming an interrupted task.",
      hasPartial ? "You have partial output from the previous attempt." : "",
      lastError ? `Previous error: ${lastError.providerMessage ?? lastError.code}` : "",
      "Continue from where the previous attempt left off.",
    ]
      .filter(Boolean)
      .join("\n");

    const userPrompt = [
      `Original task: ${run.userPrompt}`,
      hasPartial ? `Previous partial output available in context.` : "",
      "Please resume and complete the remaining work.",
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      systemPrompt,
      userPrompt,
      context: {
        partial: stage.partialOutput,
        previousSessionId: stage.checkpoint?.sessionId,
        errors: stage.errors,
        attempt: stage.attempt,
      },
    };
  }

  /**
   * 判断 stage 是否可以通过 partial output 续跑
   */
  static canResumeWithContext(stage: StageRunRecord): boolean {
    return (
      stage.partialOutput != null ||
      (stage.errors.length > 0 && stage.errors[stage.errors.length - 1].level !== "L2")
    );
  }
}
