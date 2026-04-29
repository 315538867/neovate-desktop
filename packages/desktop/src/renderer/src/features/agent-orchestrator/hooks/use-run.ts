import debug from "debug";
import { useCallback, useEffect, useRef } from "react";

import type { OrchestratorEvent } from "../store";

import { client } from "../../../orpc";
import { useOrchestratorStore } from "../store";

const hookLog = debug("neovate:use-run");

export function useRun(runId: string | null) {
  const run = useOrchestratorStore((s) => (runId ? s.runs.get(runId) : undefined));
  const upsertRun = useOrchestratorStore((s) => s.upsertRun);
  const appendRunEvent = useOrchestratorStore((s) => s.appendRunEvent);
  const setRunStatus = useOrchestratorStore((s) => s.setRunStatus);
  const abortRef = useRef<AbortController | null>(null);
  const seenSeqRef = useRef(0);

  // 订阅事件流
  useEffect(() => {
    if (!runId) return;

    const abort = new AbortController();
    abortRef.current = abort;

    // 先拉取当前状态
    client.orchestrator
      .getRun({ runId })
      .then((fresh) => {
        if (abort.signal.aborted) return;
        upsertRun(fresh);
      })
      .catch(() => {});

    // 订阅事件流
    const subscribe = async () => {
      try {
        const iterator = await client.orchestrator.subscribeRunEvents({
          runId,
          sinceSeq: 0,
        });

        for await (const event of iterator) {
          if (abort.signal.aborted) break;
          if (event && typeof event === "object") {
            const ev = event as OrchestratorEvent;
            // 根据 seq 去重
            const seq = (ev as { seq?: number }).seq ?? seenSeqRef.current + 1;
            if (seq > seenSeqRef.current) {
              seenSeqRef.current = seq;
              appendRunEvent(runId, ev);

              // 根据事件类型更新 run 状态
              if (ev.type === "run.status") {
                const status = (ev.payload as { status?: string })?.status;
                if (status) setRunStatus(runId, status as never);
              }
            }
          }
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          hookLog("subscribe error: %o", err);
        }
      }
    };

    subscribe();

    return () => {
      abort.abort();
    };
  }, [runId, upsertRun, appendRunEvent, setRunStatus]);

  const refresh = useCallback(async () => {
    if (!runId) return;
    const fresh = await client.orchestrator.getRun({ runId });
    upsertRun(fresh);
  }, [runId, upsertRun]);

  return {
    run: run?.run,
    events: run?.events ?? [],
    loaded: run?.loaded ?? false,
    refresh,
  };
}
