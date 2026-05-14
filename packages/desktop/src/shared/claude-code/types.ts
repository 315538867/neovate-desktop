import type {
  CanUseTool,
  PermissionMode,
  PermissionResult,
  SDKCompactBoundaryMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKStatusMessage,
  SDKLocalCommandOutputMessage,
  SDKHookStartedMessage,
  SDKHookProgressMessage,
  SDKHookResponseMessage,
  SDKTaskStartedMessage,
  SDKTaskProgressMessage,
  SDKTaskNotificationMessage,
  SDKFilesPersistedEvent,
  SDKElicitationCompleteMessage,
  SDKToolProgressMessage,
  SDKToolUseSummaryMessage,
  SDKAuthStatusMessage,
  SDKRateLimitEvent,
  SDKPromptSuggestionMessage,
  SDKAPIRetryMessage,
  SDKSessionStateChangedMessage,
  SDKResultSuccess,
  SDKResultError,
} from "@anthropic-ai/claude-agent-sdk";
import type { InferUIMessageChunk, UIMessage } from "ai";

import type { ClaudeCodeUITools } from "./tools";

// ─── Stream (message) ────────────────────────────────────────────────────────

type Metadata = {
  deliveryMode?: "stream" | "restored";
  sessionId: string;
  parentToolUseId: string | null;
};

type DataTypes = {
  "system/init": SDKSystemMessage;
  "system/compact_boundary": SDKCompactBoundaryMessage;
  "compact-summary": {
    trigger: "manual" | "auto";
    preTokens: number;
    postTokens?: number;
    durationMs?: number;
    summaryRaw: string;
  };
  /**
   * Domain event for slash commands the user issued.
   *
   * Claude Code CLI rewrites such user inputs into a private XML envelope
   * (e.g. `<command-name>/model</command-name><command-args>...</command-args>`)
   * when persisting to jsonl. We translate that envelope at the protocol-↔-
   * semantic boundary so downstream consumers (renderer / sidebar / rewind)
   * never see the raw XML.
   */
  "slash-command": {
    /** Command name without the leading slash (e.g. "model", "zcf:workflow"). */
    name: string;
    /** Original `<command-message>` content, often a human-readable label. */
    message?: string;
    /** Original `<command-args>` content, the user-supplied arguments. */
    args?: string;
    /** Free text that immediately follows the command in the same user turn. */
    extraText?: string;
    /** Synchronous CLI side-effect output (`<local-command-stdout>`). */
    stdout?: string;
    /** CLI advisory text (`<local-command-caveat>`). */
    caveat?: string;
  };
  "result/success": SDKResultSuccess;
} & { [K in SDKResultError["subtype"] as `result/${K}`]: SDKResultError };

export type ClaudeCodeUIMessage = UIMessage<Metadata, DataTypes, ClaudeCodeUITools>;

export type ClaudeCodeUIMessagePart = ClaudeCodeUIMessage["parts"][number];

export type ClaudeCodeUIMessageChunk = InferUIMessageChunk<ClaudeCodeUIMessage>;

export function isClaudeCodeUIMessage(value: unknown): value is ClaudeCodeUIMessage {
  return (
    value != null &&
    typeof value === "object" &&
    "id" in value &&
    "role" in value &&
    "parts" in value &&
    Array.isArray(value.parts)
  );
}

// ─── Subscribe (event) ───────────────────────────────────────────────────────

export type ContextUsageEvent = {
  type: "context_usage";
  contextWindowSize: number;
  usedTokens: number;
  remainingPct: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
};

export type ClaudeCodeUIEventPart =
  | SDKResultMessage
  | SDKSystemMessage
  | SDKStatusMessage
  | SDKLocalCommandOutputMessage
  | SDKHookStartedMessage
  | SDKHookProgressMessage
  | SDKHookResponseMessage
  | SDKTaskStartedMessage
  | SDKTaskProgressMessage
  | SDKTaskNotificationMessage
  | SDKFilesPersistedEvent
  | SDKElicitationCompleteMessage
  | SDKToolProgressMessage
  | SDKToolUseSummaryMessage
  | SDKAuthStatusMessage
  | SDKRateLimitEvent
  | SDKPromptSuggestionMessage
  | SDKAPIRetryMessage
  | SDKSessionStateChangedMessage
  | ContextUsageEvent;

export type ClaudeCodeUIEventMessage = { id: string } & ClaudeCodeUIEventPart;

type PermissionRequest = {
  type: "permission_request";
  toolName: string;
  input: Record<string, unknown>;
  options: Omit<Parameters<CanUseTool>[2], "signal">;
  /** 可选：存在表示这是一次"可提升"的请求（path-guard 发现写到非 focus 组成员） */
  elevation?: {
    /** 目标项目 id（归属判定来自 path-guard） */
    projectId: string;
    /** 目标项目显示名（用于对话框文案） */
    projectName: string;
  };
};

export type ClaudeCodeUIEventRequest = PermissionRequest;

export type ClaudeCodeUIEvent =
  | { kind: "event"; event: ClaudeCodeUIEventMessage }
  | { kind: "request"; requestId: string; request: ClaudeCodeUIEventRequest }
  | { kind: "request_settled"; requestId: string }
  | { kind: "chunk"; chunk: ClaudeCodeUIMessageChunk }
  | { kind: "user_message"; message: ClaudeCodeUIMessage };

// ─── Dispatch ────────────────────────────────────────────────────────────────

export type ClaudeCodeUIDispatch =
  | {
      kind: "respond";
      requestId: string;
      respond: {
        type: "permission_request";
        result: PermissionResult;
        /** 可选：用户在该请求中接受了"本会话内放行某项目"的提升 */
        elevation?: { projectId: string };
      };
    }
  | {
      kind: "configure";
      configure:
        | { type: "set_permission_mode"; mode: PermissionMode }
        | { type: "set_model"; model: string };
    }
  | { kind: "interrupt" }
  | { kind: "revoke_elevation"; projectId: string }
  | { kind: "elevate_project"; projectId: string };

export type ClaudeCodeUIDispatchResult =
  | { kind: "respond"; ok: boolean }
  | {
      kind: "configure";
      ok: boolean;
      configure:
        | { type: "set_permission_mode"; mode: PermissionMode }
        | { type: "set_model"; model: string };
      error?: string;
    }
  | { kind: "interrupt"; ok: boolean }
  | { kind: "revoke_elevation"; ok: boolean }
  | { kind: "elevate_project"; ok: boolean };

// ─── Re-exports (tools) ─────────────────────────────────────────────────────

export * from "./tools";
