import { ORPCError } from "@orpc/server";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { sessionContract } from "../../../shared/features/agent/contract";
import { APP_DATA_DIR } from "../../core/app-paths";
import { defineRouter } from "../../core/router-factory";
import { readModelSetting, writeModelSetting } from "./claude-settings";

const { os, log: agentLog } = defineRouter({
  contract: { session: sessionContract },
  debugNs: "neovate:agent-router",
});

export const sessionRouter = os.session.router({
  activeSessions: os.session.activeSessions.handler(({ context }) => {
    return context.sessionManager.getActiveSessions();
  }),

  subscribeSessionLifecycle: os.session.subscribeSessionLifecycle.handler(async function* ({
    context,
    signal,
  }) {
    const queue: Array<import("../../../shared/features/agent/types").SessionLifecycleEvent> = [];
    let resolve: (() => void) | null = null;

    const unsub = context.sessionManager.onLifecycle((event) => {
      queue.push(event);
      resolve?.();
    });

    const onAbort = () => resolve?.();
    signal?.addEventListener("abort", onAbort);

    try {
      while (!signal?.aborted) {
        if (queue.length === 0) {
          await new Promise<void>((r) => {
            resolve = r;
          });
        }
        while (queue.length > 0) {
          yield queue.shift()!;
        }
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      unsub();
    }
  }),

  listSessions: os.session.listSessions.handler(async ({ input, context }) => {
    const sessions = await context.sessionManager.listSessions(input.cwd);
    const startTimes = context.projectStore.getSessionStartTimes();
    for (const s of sessions) {
      const override = startTimes[s.sessionId];
      if (override) s.createdAt = override;
    }
    return sessions;
  }),

  renameSession: os.session.renameSession.handler(async ({ input, context }) => {
    agentLog("renameSession: sessionId=%s title=%s", input.sessionId, input.title);
    await context.sessionManager.renameSession(input.sessionId, input.title);
  }),

  updateSessionStartTime: os.session.updateSessionStartTime.handler(({ input, context }) => {
    context.projectStore.setSessionStartTime(input.sessionId, input.createdAt);
  }),

  claudeCode: os.session.claudeCode.router({
    createSession: os.session.claudeCode.createSession.handler(async ({ input, context }) => {
      agentLog(
        "claudeCode.createSession: cwd=%s model=%s providerId=%s",
        input.cwd,
        input.model,
        input.providerId,
      );
      try {
        return await context.sessionManager.createSession(input.cwd, input.model, input.providerId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create session";
        throw new ORPCError("BAD_GATEWAY", { defined: true, message });
      }
    }),

    send: os.session.claudeCode.send.handler(async ({ input, context }) => {
      await context.sessionManager.send(input.sessionId, input.message);
    }),

    subscribe: os.session.claudeCode.subscribe.handler(async function* ({
      input,
      context,
      signal,
    }) {
      for await (const event of context.sessionManager.eventPublisher.subscribe(input.sessionId, {
        signal,
      })) {
        yield event;
      }
    }),

    closeSession: os.session.claudeCode.closeSession.handler(async ({ input, context }) => {
      agentLog("claudeCode.closeSession: sessionId=%s", input.sessionId);
      await context.sessionManager.closeSession(input.sessionId);
    }),

    dispatch: os.session.claudeCode.dispatch.handler(({ input, context }) => {
      return context.sessionManager.handleDispatch(input.sessionId, input.dispatch);
    }),

    loadSession: os.session.claudeCode.loadSession.handler(async ({ input, context }) => {
      agentLog("claudeCode.loadSession: sessionId=%s cwd=%s", input.sessionId, input.cwd);
      try {
        return await context.sessionManager.loadSession(input.sessionId, input.cwd);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load session";
        agentLog("claudeCode.loadSession: FAILED error=%s", message);
        throw new ORPCError("BAD_GATEWAY", { defined: true, message });
      }
    }),
  }),

  network: os.session.network.router({
    listRequests: os.session.network.listRequests.handler(({ input, context }) => {
      return context.requestTracker.getRequests(input.sessionId);
    }),

    getRequestDetail: os.session.network.getRequestDetail.handler(({ input, context }) => {
      return context.requestTracker.getRequestDetail(input.sessionId, input.requestId);
    }),

    getInspectorState: os.session.network.getInspectorState.handler(({ input, context }) => {
      return context.requestTracker.getInspectorState(input.sessionId);
    }),

    clearRequests: os.session.network.clearRequests.handler(({ input, context }) => {
      context.requestTracker.clearRequests(input.sessionId);
    }),

    subscribe: os.session.network.subscribe.handler(async function* ({ input, context, signal }) {
      for await (const summary of context.requestTracker.eventPublisher.subscribe(input.sessionId, {
        signal,
      })) {
        yield summary;
      }
    }),
  }),

  forkSession: os.session.forkSession.handler(async ({ input, context }) => {
    agentLog("forkSession: sessionId=%s cwd=%s", input.sessionId, input.cwd);
    return context.sessionManager.forkSession(input.sessionId, input.cwd, input.title);
  }),

  rewindFilesDryRun: os.session.rewindFilesDryRun.handler(async ({ input, context }) => {
    return context.sessionManager.rewindFilesDryRun(input.sessionId, input.messageId);
  }),

  rewindToMessage: os.session.rewindToMessage.handler(async ({ input, context }) => {
    agentLog(
      "rewindToMessage: sessionId=%s messageId=%s restoreFiles=%s",
      input.sessionId,
      input.messageId,
      input.restoreFiles,
    );
    return context.sessionManager.rewindToMessage(
      input.sessionId,
      input.messageId,
      input.restoreFiles,
      input.title,
    );
  }),

  deleteSessionFile: os.session.deleteSessionFile.handler(async ({ input, context }) => {
    agentLog("deleteSessionFile: sessionId=%s", input.sessionId);
    await context.sessionManager.deleteSessionFile(input.sessionId);
  }),

  archiveSessionFile: os.session.archiveSessionFile.handler(async ({ input, context }) => {
    agentLog("archiveSessionFile: sessionId=%s", input.sessionId);
    await context.sessionManager.archiveSessionFile(input.sessionId, {
      forkedSessionId: input.forkedSessionId,
      rewindMessageId: input.rewindMessageId,
      restoreFiles: input.restoreFiles,
      title: input.title,
      cwd: input.cwd,
    });
  }),

  savePlan: os.session.savePlan.handler(async ({ input }) => {
    const slug = input.title
      ? input.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .slice(0, 50)
      : input.sessionId.slice(0, 8);
    const filename = `${new Date().toISOString().slice(0, 10)}-${slug}.md`;
    const dir = join(APP_DATA_DIR, "plans");
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, filename);
    await writeFile(filePath, input.plan, "utf8");
    agentLog("savePlan: saved to %s", filePath);
    return { path: filePath };
  }),

  setModelSetting: os.session.setModelSetting.handler(async ({ input, context }) => {
    const { sessionId, model, scope } = input;
    const cwd = context.sessionManager.getSessionCwd(sessionId);
    agentLog(
      "setModelSetting: sessionId=%s model=%s scope=%s cwd=%s",
      sessionId,
      model,
      scope,
      cwd,
    );
    await writeModelSetting(scope, model, { sessionId, cwd });
    // setModelSetting is only called for SDK Default — clear any provider at this scope
    if (scope === "project") {
      context.projectStore.setProjectSelection(cwd, null, null);
    } else if (scope === "global") {
      context.configStore.setGlobalSelection(null, null);
    }
    const effective = await readModelSetting(sessionId, cwd);
    return { currentModel: effective?.model, modelScope: effective?.scope };
  }),
});
