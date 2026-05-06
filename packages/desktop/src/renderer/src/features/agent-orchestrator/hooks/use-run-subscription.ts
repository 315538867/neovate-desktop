/**
 * `useRunSubscription` — stream trace events for a specific run.
 *
 * Mirrors the pattern in `use-session-lifecycle-subscription.ts`: opens an
 * async iterator via `client.agent.orchestrator.subscribeRun`, drains it
 * into the store, and reconciles by re-fetching the full run when the
 * subscription drops or the run id changes.
 */

import debug from "debug";
import { useEffect } from "react";

import type { TraceEvent } from "../../../../../shared/features/agent-orchestrator/types";

import { client } from "../../../orpc";
import { useOrchestratorStore } from "../store";

const log = debug("neovate:orchestrator:use-run-subscription");

export function useRunSubscription(runId: string | null) {
  const appendTraceEvent = useOrchestratorStore((s) => s.appendTraceEvent);
  const setActiveRun = useOrchestratorStore((s) => s.setActiveRun);
  const resetEventsForRun = useOrchestratorStore((s) => s.resetEventsForRun);

  useEffect(() => {
    if (!runId) {
      setActiveRun(null);
      return;
    }

    let cancelled = false;
    let iter: AsyncIterableIterator<TraceEvent> | undefined;

    const fetchRunDetail = async () => {
      try {
        const run = await client.agent.orchestrator.getRun({ runId });
        if (!cancelled) setActiveRun(run);
      } catch (err) {
        log("getRun failed: %O", err);
      }
    };

    const drain = async () => {
      while (!cancelled) {
        try {
          iter = await client.agent.orchestrator.subscribeRun({ runId });
          for await (const event of iter) {
            if (cancelled) break;
            appendTraceEvent(event);
            // Refresh full run detail on lifecycle-impacting events so the
            // active panel reflects status / current stage transitions.
            if (
              event.type === "run.start" ||
              event.type === "run.end" ||
              event.type === "stage.end" ||
              event.type === "stage.error" ||
              event.type === "gate.resolved"
            ) {
              await fetchRunDetail();
            }
          }
        } catch (err) {
          if (cancelled) break;
          log("subscription dropped runId=%s: %O", runId, err);
          // Rehydrate from canonical source after a drop.
          await fetchRunDetail();
          // Brief backoff before retrying — keeps the renderer from busy
          // looping when the main side rejects (e.g. unknown run id).
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    };

    resetEventsForRun(runId);
    void fetchRunDetail();
    void drain();

    return () => {
      cancelled = true;
      iter?.return?.(undefined);
    };
  }, [runId, appendTraceEvent, setActiveRun, resetEventsForRun]);
}
