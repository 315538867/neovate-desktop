/**
 * `useRuns` — load templates + run summaries when the panel opens.
 *
 * Single-shot fetch on mount + when the active project changes; relies on
 * the live `subscribeAll` (in a sibling hook) and `upsertRunSummary` to
 * stay in sync afterwards. Failures are surfaced via the store's
 * `loadError` field rather than thrown.
 */

import debug from "debug";
import { useCallback, useEffect } from "react";

import { client } from "../../../orpc";
import { useOrchestratorStore } from "../store";

const log = debug("neovate:orchestrator:use-runs");

type UseRunsOptions = {
  projectId?: string;
  /** When false, the hook is dormant. */
  enabled?: boolean;
};

export function useRuns({ projectId, enabled = true }: UseRunsOptions = {}) {
  const setTemplates = useOrchestratorStore((s) => s.setTemplates);
  const setRuns = useOrchestratorStore((s) => s.setRuns);
  const setIsLoadingTemplates = useOrchestratorStore((s) => s.setIsLoadingTemplates);
  const setIsLoadingRuns = useOrchestratorStore((s) => s.setIsLoadingRuns);
  const setLoadError = useOrchestratorStore((s) => s.setLoadError);

  const refresh = useCallback(async () => {
    setLoadError(null);
    setIsLoadingTemplates(true);
    setIsLoadingRuns(true);
    try {
      const [templates, runs] = await Promise.all([
        client.agent.orchestrator.listTemplates({}),
        client.agent.orchestrator.listRuns(projectId ? { projectId } : undefined),
      ]);
      setTemplates(templates);
      setRuns(runs);
      log("loaded templates=%d runs=%d projectId=%s", templates.length, runs.length, projectId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load orchestrator data";
      log("load failed: %s", message);
      setLoadError(message);
    } finally {
      setIsLoadingTemplates(false);
      setIsLoadingRuns(false);
    }
  }, [projectId, setTemplates, setRuns, setIsLoadingTemplates, setIsLoadingRuns, setLoadError]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  return { refresh };
}
