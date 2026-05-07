/**
 * Constructs the six per-concern context bundles that the session helpers
 * consume. Pulled out of `SessionManager`'s constructor to keep that class
 * focused on field declarations and public method delegates.
 *
 * The bundles intentionally share underlying Map/Set/EventPublisher
 * references — mutations made through one helper must be observable to
 * the others. Callbacks (`closeSession`, `createSession`, `emitLifecycle`,
 * `startConsume`, `getAgentContributions`) are passed in by the manager so
 * dispatch always lands on the live instance.
 *
 * Behavior must remain bit-for-bit identical to the inlined versions —
 * pure relocation, not a redesign.
 */

import type { EventPublisher } from "@orpc/server";

import type { ClaudeCodeUIEvent } from "../../../../shared/claude-code/types";
import type { SessionLifecycleEvent } from "../../../../shared/features/agent/types";
import type { Contributions } from "../../../core/plugin/contributions";
import type { PowerBlockerService } from "../../../core/power-blocker-service";
import type { ConfigStore } from "../../config/config-store";
import type { ProjectStore } from "../../project/project-store";
import type { RequestTracker } from "../request-tracker";
import type { CloseContext } from "./close";
import type { DispatchContext } from "./dispatch";
import type { FacadeContext } from "./facade";
import type { ForkContext } from "./fork";
import type { InitContext } from "./init";
import type { SendContext } from "./send";
import type { SessionEntry } from "./types";

type LogFn = (fmt: string, ...args: unknown[]) => void;

/**
 * Inputs the manager hands the builder. Mutable collections are shared
 * by reference; callbacks are bound to manager methods so they always
 * dispatch to the live instance.
 */
export interface SessionContextsDeps {
  sessions: Map<string, SessionEntry>;
  emittedCreatedSessions: Set<string>;
  closingSessions: Set<string>;

  configStore: ConfigStore;
  projectStore: ProjectStore;
  requestTracker: RequestTracker;
  powerBlocker: PowerBlockerService;
  eventPublisher: EventPublisher<Record<string, ClaudeCodeUIEvent>>;

  getAgentContributions: () => Contributions["agents"];
  closeSession: (sessionId: string) => Promise<void>;
  createSession: (cwd: string) => Promise<{ sessionId: string }>;
  startConsume: (sessionId: string) => void;
  emitLifecycle: (event: SessionLifecycleEvent) => void;

  log: LogFn;
  rtkLog: LogFn;
}

export interface SessionContexts {
  initContext: InitContext;
  sendContext: SendContext;
  dispatchContext: DispatchContext;
  closeContext: CloseContext;
  facadeContext: FacadeContext;
  forkContext: ForkContext;
}

export function buildSessionContexts(deps: SessionContextsDeps): SessionContexts {
  const initContext: InitContext = {
    sessions: deps.sessions,
    configStore: deps.configStore,
    requestTracker: deps.requestTracker,
    eventPublisher: deps.eventPublisher,
    powerBlocker: deps.powerBlocker,
    getAgentContributions: deps.getAgentContributions,
    closeSession: deps.closeSession,
    startConsume: deps.startConsume,
    log: deps.log,
    rtkLog: deps.rtkLog,
  };

  const sendContext: SendContext = {
    sessions: deps.sessions,
    emittedCreatedSessions: deps.emittedCreatedSessions,
    emitLifecycle: deps.emitLifecycle,
    requestTracker: deps.requestTracker,
    powerBlocker: deps.powerBlocker,
    eventPublisher: deps.eventPublisher,
  };

  const dispatchContext: DispatchContext = {
    sessions: deps.sessions,
    configStore: deps.configStore,
    log: deps.log,
  };

  const closeContext: CloseContext = {
    sessions: deps.sessions,
    closingSessions: deps.closingSessions,
    emittedCreatedSessions: deps.emittedCreatedSessions,
    requestTracker: deps.requestTracker,
    powerBlocker: deps.powerBlocker,
    eventPublisher: deps.eventPublisher,
    log: deps.log,
  };

  const facadeContext: FacadeContext = {
    configStore: deps.configStore,
    projectStore: deps.projectStore,
    initContext,
    log: deps.log,
  };

  const forkContext: ForkContext = {
    sessions: deps.sessions,
    closeSession: deps.closeSession,
    createSession: deps.createSession,
    emitLifecycle: deps.emitLifecycle,
    log: deps.log,
  };

  return {
    initContext,
    sendContext,
    dispatchContext,
    closeContext,
    facadeContext,
    forkContext,
  };
}
