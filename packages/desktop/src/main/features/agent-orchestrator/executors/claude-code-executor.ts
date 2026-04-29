import type { ClaudeCodeUIEvent, ClaudeCodeUIMessage } from "../../../../shared/claude-code/types";
import type {
  AgentExecutor,
  ExecutorEvent,
  ExecutorInput,
} from "../../../../shared/features/agent-orchestrator/executor-types";
import type { SessionManager } from "../../agent/session-manager";

import { classifyError } from "../errors/error-classifier";

export class ClaudeCodeExecutor implements AgentExecutor {
  readonly id = "claude-code";
  readonly displayName = "Claude Code";
  readonly capabilities = {
    streaming: true,
    fileTools: true,
    shellTools: true,
    subAgents: true,
    structuredOutput: true,
    maxContextTokens: 200_000,
  };

  constructor(private sessionManager: SessionManager) {}

  async *execute(input: ExecutorInput): AsyncIterable<ExecutorEvent> {
    // 1. 创建 session
    const { sessionId } = await this.sessionManager.createSession(input.workspacePath);

    try {
      // 2. 订阅事件流
      const eventStream = this.sessionManager.eventPublisher.subscribe(sessionId, {
        signal: input.abortSignal,
      });

      let totalTokens = 0;

      // 3. 发送 user prompt
      const message: ClaudeCodeUIMessage = {
        role: "user",
        content: [{ type: "text", text: input.systemPrompt + "\n\n---\n\n" + input.userPrompt }],
      } as unknown as ClaudeCodeUIMessage;

      await this.sessionManager.send(sessionId, message);

      // 4. 转译事件
      for await (const ev of eventStream) {
        if (input.abortSignal.aborted) {
          await this.sessionManager.handleDispatch(sessionId, {
            kind: "interrupt",
          });
          return;
        }

        yield* this.translateEvent(ev, totalTokens);
      }
    } catch (err) {
      const classification = classifyError(err);
      yield {
        type: "error",
        level: classification.level,
        code: classification.code,
        message: String(err),
        httpStatus: classification.httpStatus,
      };
    } finally {
      // 清理 session
      try {
        await this.sessionManager.closeSession(sessionId);
      } catch {
        // 忽略关闭错误
      }
    }
  }

  private async *translateEvent(
    ev: ClaudeCodeUIEvent,
    _totalTokens: number,
  ): AsyncIterable<ExecutorEvent> {
    switch (ev.kind) {
      case "chunk": {
        const chunk = ev.chunk;
        switch (chunk.type) {
          case "text-delta":
            if (chunk.delta) {
              yield { type: "text", delta: chunk.delta };
            }
            break;

          case "tool-input-available":
            yield {
              type: "tool-call",
              tool: chunk.toolName,
              args: chunk.input,
              callId: chunk.toolCallId,
            };
            break;

          case "tool-output-available":
            yield {
              type: "tool-result",
              callId: chunk.toolCallId,
              result: chunk.output,
              isError: false,
            };
            break;

          case "tool-output-error":
            yield {
              type: "tool-result",
              callId: chunk.toolCallId,
              result: chunk.errorText,
              isError: true,
            };
            break;
        }
        break;
      }

      case "event": {
        const e = ev.event;
        switch (e.type) {
          case "context_usage":
            yield {
              type: "usage",
              tokens: e.totalInputTokens ?? e.usedTokens ?? 0,
            };
            break;
          case "result":
            // 任务完成 — 请求结构化输出
            yield {
              type: "done",
              summary: {
                tokensUsed: 0,
                durationMs: 0,
              },
            };
            break;
        }
        break;
      }

      case "request":
        // 权限请求 — 暂时自动批准工具调用
        break;

      case "request_settled":
        break;

      case "user_message":
        break;
    }
  }

  async cancel(): Promise<void> {
    // 由 abortSignal 触发；执行内会调用 handleDispatch
  }
}
