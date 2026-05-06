import { deeplinkContract } from "../../../shared/features/deeplink/contract";
import { defineRouter } from "../../core/router-factory";

const { os } = defineRouter({
  contract: { deeplink: deeplinkContract },
  debugNs: "neovate:deeplink",
});

export const deeplinkRouter = os.deeplink.router({
  subscribe: os.deeplink.subscribe.handler(async function* ({ context, signal }) {
    const service = context.mainApp.deeplink;

    // 1. Register listener FIRST (new events buffered in iterator from here)
    const iterator = service.publisher.subscribe("deeplink", { signal });

    // 2. Yield pending events (published before any subscriber existed)
    for (const event of service.consumePending()) {
      yield event;
    }

    // 3. Yield real-time stream (seamless, no gap)
    for await (const event of iterator) {
      yield event;
    }
  }),
});
