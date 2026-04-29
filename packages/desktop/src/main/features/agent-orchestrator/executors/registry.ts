import type { AgentExecutor } from "../../../../shared/features/agent-orchestrator/executor-types";

const executors = new Map<string, AgentExecutor>();

export function registerExecutor(executor: AgentExecutor): void {
  executors.set(executor.id, executor);
}

export function getExecutor(id: string): AgentExecutor | undefined {
  return executors.get(id);
}

export function listExecutors(): AgentExecutor[] {
  return Array.from(executors.values());
}

export function isCapabilityMatch(
  executor: AgentExecutor,
  required: Partial<AgentExecutor["capabilities"]>,
): boolean {
  const caps = executor.capabilities;
  if (required.streaming && !caps.streaming) return false;
  if (required.fileTools && !caps.fileTools) return false;
  if (required.shellTools && !caps.shellTools) return false;
  if (required.subAgents && !caps.subAgents) return false;
  if (required.structuredOutput && !caps.structuredOutput) return false;
  return true;
}
