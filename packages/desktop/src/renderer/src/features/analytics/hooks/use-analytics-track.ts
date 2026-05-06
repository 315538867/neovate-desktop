import { useCallback } from "react";

import type {
  ProgrammaticEventName,
  ProgrammaticEventProperties,
} from "../../../../../shared/features/analytics/events";

import { useRendererApp } from "../../../core/app";

export function useAnalyticsTrack() {
  const app = useRendererApp();
  return useCallback(
    <T extends ProgrammaticEventName>(event: T, properties: ProgrammaticEventProperties<T>) => {
      // noop: analytics is fire-and-forget — failures must remain silent
      Promise.resolve(
        app.analytics.track(event, { ...properties, trackType: "programmatic" }),
      ).catch(() => {});
    },
    [app],
  );
}
