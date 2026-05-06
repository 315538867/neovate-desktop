import { oc, type, eventIterator } from "@orpc/contract";
import { z } from "zod";

export interface DeeplinkEvent {
  name: string;
  path: string;
  searchParams: Record<string, string>;
  data?: unknown;
  /** true when no main-process handler was registered for this name */
  unhandled: boolean;
}

/**
 * A request from main asking the user to confirm a deeplink before it
 * is dispatched. Surface this in the UI as a modal (Wave 4.3 commit 7.3).
 */
export interface DeeplinkConfirmRequest {
  /** Stable id used to match the response back to the request. */
  requestId: string;
  /** Raw URL captured from `app.on("open-url")`. Display verbatim. */
  url: string;
  /** Parsed scheme, e.g. "neovate". */
  scheme: string;
  /** Parsed host (= deeplink "name"), e.g. "session". */
  host: string;
}

export const deeplinkContract = {
  subscribe: oc.output(eventIterator(type<DeeplinkEvent>())),

  /**
   * Stream of confirm requests from main. Renderer subscribes once at
   * startup, shows a modal per emitted request, and replies via
   * `respondConfirmRequest`.
   */
  subscribeConfirmRequest: oc.output(eventIterator(type<DeeplinkConfirmRequest>())),

  /**
   * Renderer's answer (approve / reject) for a pending confirm request.
   * Unknown / already-resolved requestIds are silently ignored.
   */
  respondConfirmRequest: oc
    .input(z.object({ requestId: z.string(), approved: z.boolean() }))
    .output(type<void>()),
};
