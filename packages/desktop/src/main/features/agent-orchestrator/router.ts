/**
 * Agent Orchestrator — oRPC router.
 *
 * Thin handler layer that delegates each contract leaf to the
 * `Orchestrator` façade attached to `AppContext.orchestrator`.
 *
 * The two streaming leaves (`subscribeRun` / `subscribeAll`) follow the
 * same `async function*` pattern used by `features/agent/router.ts` so
 * client subscribers honour AbortSignal teardown deterministically.
 */

import { ORPCError } from "@orpc/server";

import { orchestratorContract } from "../../../shared/features/agent-orchestrator/contract";
import { defineRouter } from "../../core/router-factory";

const { os, log } = defineRouter({
  contract: { orchestrator: orchestratorContract },
  debugNs: "neovate:orchestrator:router",
});

const wrap = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("handler error: %s", message);
    throw new ORPCError("BAD_GATEWAY", { defined: true, message });
  }
};

export const orchestratorRouter = os.orchestrator.router({
  listTemplates: os.orchestrator.listTemplates.handler(({ context }) =>
    wrap(() => context.orchestrator.listTemplates()),
  ),

  startRun: os.orchestrator.startRun.handler(async ({ input, context }) => {
    try {
      return await context.orchestrator.startRun(input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("startRun failed: %s", message);
      throw new ORPCError("BAD_GATEWAY", { defined: true, message });
    }
  }),

  getRun: os.orchestrator.getRun.handler(({ input, context }) =>
    wrap(() => context.orchestrator.getRun(input.runId)),
  ),

  listRuns: os.orchestrator.listRuns.handler(({ input, context }) =>
    wrap(() => context.orchestrator.listRuns(input)),
  ),

  cancelRun: os.orchestrator.cancelRun.handler(async ({ input, context }) => {
    try {
      return await context.orchestrator.cancelRun(input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("cancelRun failed: %s", message);
      throw new ORPCError("BAD_GATEWAY", { defined: true, message });
    }
  }),

  listRecoverableRuns: os.orchestrator.listRecoverableRuns.handler(({ context }) =>
    wrap(() => context.orchestrator.listRecoverableRuns()),
  ),

  resumeRunWithStrategy: os.orchestrator.resumeRunWithStrategy.handler(
    async ({ input, context }) => {
      try {
        return await context.orchestrator.resumeRunWithStrategy(input);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log("resumeRunWithStrategy failed: %s", message);
        throw new ORPCError("BAD_GATEWAY", { defined: true, message });
      }
    },
  ),

  approveGate: os.orchestrator.approveGate.handler(({ input, context }) =>
    wrap(() => context.orchestrator.approveGate(input)),
  ),

  subscribeRun: os.orchestrator.subscribeRun.handler(async function* ({ input, context, signal }) {
    const iter = context.orchestrator.subscribeRun(input.runId);
    const onAbort = () => {
      void iter.return?.(undefined);
    };
    signal?.addEventListener("abort", onAbort);
    try {
      for await (const event of iter) {
        if (signal?.aborted) break;
        yield event;
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }),

  subscribeAll: os.orchestrator.subscribeAll.handler(async function* ({ input, context, signal }) {
    const iter = context.orchestrator.subscribeAll(input ?? {});
    const onAbort = () => {
      void iter.return?.(undefined);
    };
    signal?.addEventListener("abort", onAbort);
    try {
      for await (const event of iter) {
        if (signal?.aborted) break;
        yield event;
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }),

  listCheckpoints: os.orchestrator.listCheckpoints.handler(({ input, context }) =>
    wrap(() => context.orchestrator.listCheckpoints(input.runId)),
  ),
});
