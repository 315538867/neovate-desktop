/**
 * Agent Orchestrator — Resume preamble builder.
 *
 * When the orchestrator re-enters an interrupted run, each replayed
 * stage receives a small preamble prepended to its prompt. The preamble
 * tells the model:
 *   • the run / stage being resumed
 *   • the chosen resume strategy (semantic guidance to the model)
 *   • the previous failure reason / partial summary, if any
 *   • an optional user note from the recovery dialog
 *
 * Keeping this purely string-shaping keeps it trivial to unit-test.
 */

import type {
  ResumeStrategy,
  Run,
  StageExecution,
  StageNode,
} from "../../../../shared/features/agent-orchestrator/types";

const SUMMARY_LIMIT = 600;
const NOTE_LIMIT = 400;

export type ResumePromptArgs = {
  run: Run;
  stage: StageNode;
  strategy: ResumeStrategy;
  /** User-provided note from the resume dialog. */
  note?: string;
};

/**
 * Build an augmentation block prepended to the original stage prompt
 * when resuming. The orchestrator concatenates this with the template's
 * `prompt` so the model sees full context.
 */
export function buildResumePreamble(args: ResumePromptArgs): string {
  const { run, stage, strategy, note } = args;
  const lines: string[] = [];
  lines.push("[orchestrator: resume context]");
  lines.push(`run=${run.id} stage=${stage.id} strategy=${strategy}`);

  const previous = lastExecutionFor(run, stage.id);
  if (previous) {
    lines.push(`previous_status=${previous.status}`);
    if (previous.error?.message) {
      lines.push(`previous_error=${previous.error.message}`);
    }
    if (previous.output?.summary) {
      lines.push(`previous_summary=${truncate(previous.output.summary, SUMMARY_LIMIT)}`);
    }
  }

  if (note) {
    lines.push(`user_note=${truncate(note, NOTE_LIMIT)}`);
  }

  lines.push(strategyGuidance(strategy));
  return lines.join("\n");
}

function strategyGuidance(strategy: ResumeStrategy): string {
  switch (strategy) {
    case "resume_from_checkpoint":
      return "Continue from the last successful checkpoint. Re-emit only what is missing; avoid duplicating work that already landed.";
    case "restart_failed_stage":
      return "Restart this stage from scratch. Do not assume prior side effects persisted.";
    case "skip_failed_stage":
      return "Skip the previously failed work and synthesize an output that lets the next stage proceed.";
    case "abort":
      return "Abort requested — no further action expected.";
  }
}

function lastExecutionFor(run: Run, stageId: string): StageExecution | undefined {
  for (let i = run.executions.length - 1; i >= 0; i--) {
    const exec = run.executions[i];
    if (exec && exec.stageId === stageId) return exec;
  }
  return undefined;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}
