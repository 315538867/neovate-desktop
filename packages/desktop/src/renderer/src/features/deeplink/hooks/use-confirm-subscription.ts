import debug from "debug";
import { useEffect } from "react";

import type { DeeplinkConfirmRequest } from "../../../../../shared/features/deeplink/contract";

import { client } from "../../../orpc";
import { useDeeplinkConfirmStore } from "../store";

const log = debug("neovate:deeplink:confirm");

/**
 * Subscribe (once, at app startup) to main's deeplink confirm request
 * stream. Each request becomes a queued entry in the store, which the
 * dialog component renders one at a time.
 *
 * Reconnects with a small backoff if the iterator throws — this matters
 * during app reload / reconnect cycles.
 */
export function useDeeplinkConfirmSubscription(): void {
  const enqueue = useDeeplinkConfirmStore((s) => s.enqueue);

  useEffect(() => {
    let stopped = false;

    const run = async () => {
      while (!stopped) {
        try {
          const iterator = await client.deeplink.subscribeConfirmRequest();
          for await (const event of iterator) {
            if (stopped) return;
            log("received confirm request id=%s url=%s", event.requestId, event.url);
            enqueue(event as DeeplinkConfirmRequest);
          }
        } catch (err) {
          if (stopped) return;
          log("confirm subscription error, retrying: %O", err);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    };

    void run();
    return () => {
      stopped = true;
    };
  }, [enqueue]);
}
