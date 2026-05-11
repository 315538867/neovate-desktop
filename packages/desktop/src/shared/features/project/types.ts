import type { ProjectProviderConfig } from "../provider/types";

export type Project = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastAccessedAt: string;
};

/** Project enriched with runtime status (not persisted). */
export type ProjectInfo = Project & {
  pathMissing?: boolean;
};

// ── Project Groups ──────────────────────────────────────────────

/** 组成员的角色：受约束的短标签，仅作为 AI 的语义提示 */
export type ProjectRole = "library" | "consumer" | "shared" | "service" | "tool" | "other";

export type ProjectGroupMember = {
  /** 引用 Project.id */
  projectId: string;
  /** 角色 */
  role: ProjectRole;
};

export type ProjectGroup = {
  id: string;
  /** 组名（用户输入，如 "Edu"） */
  name: string;
  /** 成员列表（顺序即展示顺序） */
  members: ProjectGroupMember[];
  /** 创建/更新时间戳 */
  createdAt: string;
  lastUpdatedAt: string;
};

export type ProjectStore = {
  projects: Project[];
  activeProjectId: string | null;
  /** projectPath → archived sessionIds */
  archivedSessions: Record<string, string[]>;
  /** projectPath → pinned sessionIds */
  pinnedSessions: Record<string, string[]>;
  closedProjectAccordions: string[];
  /** projectPath → provider/model selection */
  providerSelections: Record<string, ProjectProviderConfig>;
  /** sessionId → corrected createdAt ISO string (overrides file birthtime) */
  sessionStartTimes: Record<string, string>;
  /** Consecutive crash count for crash-loop detection */
  crashCount: number;
  /** Timestamp of last crash (ms since epoch) */
  lastCrashTs: number;
  /** 项目分组 */
  groups: ProjectGroup[];
};
