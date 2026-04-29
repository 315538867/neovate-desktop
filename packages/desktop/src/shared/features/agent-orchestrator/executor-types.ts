import type { z } from "zod";

import type { PipelineRun, TaskInput } from "./schemas";

// ============================================================
// Executor
// ============================================================

export interface ExecutorCapabilities {
  streaming: boolean;
  fileTools: boolean;
  shellTools: boolean;
  subAgents: boolean;
  structuredOutput: boolean;
  maxContextTokens: number;
}

export interface ExecutorInput {
  systemPrompt: string;
  userPrompt: string;
  workspacePath: string;
  outputSchema?: z.ZodSchema;
  toolWhitelist?: string[];
  abortSignal: AbortSignal;
  resumeContext?: {
    partial: unknown;
    previousSessionId?: string;
  };
}

export type ExecutorEvent =
  | { type: "text"; delta: string }
  | {
      type: "tool-call";
      tool: string;
      args: unknown;
      callId: string;
    }
  | {
      type: "tool-result";
      callId: string;
      result: unknown;
      isError?: boolean;
    }
  | { type: "subtask-started"; taskId: string; description: string }
  | { type: "subtask-completed"; taskId: string; result: unknown }
  | { type: "subtask-failed"; taskId: string; error: string }
  | { type: "file-changed"; change: unknown }
  | { type: "usage"; tokens: number; cost?: number }
  | { type: "structured-output"; data: unknown }
  | {
      type: "done";
      summary: { tokensUsed: number; durationMs: number };
    }
  | {
      type: "error";
      level: "L0" | "L1" | "L2";
      code: string;
      message: string;
      httpStatus?: number;
    };

export interface AgentExecutor {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ExecutorCapabilities;
  execute(input: ExecutorInput): AsyncIterable<ExecutorEvent>;
  cancel(): Promise<void>;
}

// ============================================================
// Orchestrator Config
// ============================================================

export interface OrchestratorConfig {
  mode: "standard" | "orchestrated";
  defaultExecutorMap: Record<string, string>;
  autoRunValidator: boolean;
  maxConcurrentRuns: number;
}

// ============================================================
// Pipeline Context
// ============================================================

export interface PipelineContext {
  run: PipelineRun;
  taskInput: TaskInput;
  workspacePath: string;
  sandboxPath?: string;
  config: OrchestratorConfig;
}

// ============================================================
// Stage Plugin
// ============================================================

export interface StagePlugin<TInput = unknown, TOutput = unknown> {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  inputSchema: z.ZodSchema<TInput>;
  outputSchema: z.ZodSchema<TOutput>;
  requiredCapabilities: Partial<ExecutorCapabilities>;
  defaultSystemPrompt: string;
  buildInput(ctx: PipelineContext, upstreamOutputs: Map<string, unknown>): TInput;
  customizePrompt?(executor: AgentExecutor, basePrompt: string): string;
  renderer?: string;
}
