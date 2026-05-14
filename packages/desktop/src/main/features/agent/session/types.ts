/**
 * Pure types and constants for the session module. Lives separate from
 * the `SessionManager` class so sub-modules (lifecycle, store,
 * rewind-fork, subscriber) can share these declarations without
 * pulling in the manager itself.
 */

import type { PermissionResult, Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

import type { ConversationKind } from "../../../../shared/features/agent/types";
import type { Pushable } from "../pushable";

/** Resolver invoked when a pending permission request settles. */
export type PendingRequestResolver = (result: PermissionResult) => void;

/** 组成员的展开信息（路径快照，启动时计算） */
export type GroupMemberSnapshot = {
  projectId: string;
  role?: string;
  path: string | null;
  name: string;
  missing: boolean;
};

/** In-memory bookkeeping for one active ACP session. */
export interface SessionEntry {
  input: Pushable<SDKUserMessage>;
  query: Query;
  cwd: string;
  providerId?: string;
  model?: string;
  createdAt: number;
  lastUserMessageId?: string;
  preTurnRef?: string;
  consumeExited: boolean;
  /** Maps UI message IDs to SDK UUIDs for rewind. */
  uiToSdkMessageIds: Map<string, string>;
  pendingRequests: Map<string, { resolve: PendingRequestResolver }>;
  /** 会话类型，单项目会话默认 single */
  kind: ConversationKind;
  /** 分组 id（kind === "group" 时） */
  groupId?: string;
  /** 组对话：成员路径快照 */
  groupMembers?: GroupMemberSnapshot[];
  /** 待在下一次 UserPromptSubmit hook 注入的提示（如成员变更） */
  pendingHint?: string;
  /** 组对话：本会话内已临时授权可写的项目 id 集合（不持久化，内存级） */
  elevatedProjectIds?: Set<string>;
}

/** Timeout for SDK `initializationResult()` to prevent hanging sessions. */
export const INIT_TIMEOUT_MS = 30_000;

/**
 * Environment variables we explicitly do NOT forward into the spawned
 * Claude Code subprocess. They either belong to Electron internals
 * (`ELECTRON_RUN_AS_NODE`), require special handling per-process
 * (`PATH`, `HOME`, `SHELL`, `USER`), or are well-known dynamic-library
 * injection vectors that must never be inherited.
 */
export const ENV_BLOCKLIST: ReadonlySet<string> = new Set([
  "ELECTRON_RUN_AS_NODE",
  "NODE_OPTIONS",
  "PATH",
  "HOME",
  "SHELL",
  "USER",
  "LD_PRELOAD",
  "DYLD_INSERT_LIBRARIES",
]);
