import { EventPublisher } from "@orpc/server";
import debug from "debug";
import { randomUUID } from "node:crypto";

import type { DeeplinkConfirmRequest } from "../../../shared/features/deeplink/contract";

const log = debug("neovate:deeplink:confirm");

/**
 * Default time the user has to acknowledge a deeplink before main rejects
 * the action. Picked to be long enough that a distracted user can switch
 * back to the window, but short enough that a stale prompt does not
 * silently keep the deeplink around.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

interface PendingEntry {
  resolve: (approved: boolean) => void;
  timer: NodeJS.Timeout;
}

/**
 * Bridge between main's deeplink dispatcher and the renderer's confirm
 * dialog (Wave 4.3 commit 7.3).
 *
 * - `request()` is called from main BEFORE running the handler. It pushes
 *   a `DeeplinkConfirmRequest` to all subscribed renderers and returns a
 *   promise that resolves to `true` (approved) / `false` (rejected) /
 *   `false` (timeout, default-deny).
 * - `respond()` is called by the oRPC router when the renderer answers.
 *   Unknown ids are no-ops — this lets us drop late responses safely.
 *
 * Default-deny on timeout is deliberate: if the renderer is unresponsive
 * we should NOT silently dispatch the deeplink. The whole point of this
 * modal is to require a positive user action before any side-effect runs.
 */
export class DeeplinkConfirmBus {
  readonly publisher = new EventPublisher<{ confirm: DeeplinkConfirmRequest }>();
  private pending = new Map<string, PendingEntry>();

  constructor(private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

  /**
   * Ask the user to confirm a deeplink. Resolves to `true` if approved,
   * `false` if rejected or if the timeout fires before any response.
   *
   * If no renderer is subscribed (e.g. all windows closed before the
   * dialog could show), this still respects the timeout and resolves
   * `false` — main should NOT proceed without an explicit approval.
   */
  request(input: { url: string; scheme: string; host: string }): Promise<boolean> {
    const requestId = randomUUID();
    const event: DeeplinkConfirmRequest = { requestId, ...input };
    log("request id=%s url=%s subscribers=%d", requestId, input.url, this.publisher.size);

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(requestId)) {
          log("request id=%s timed out — default deny", requestId);
          resolve(false);
        }
      }, this.timeoutMs);

      this.pending.set(requestId, { resolve, timer });
      this.publisher.publish("confirm", event);
    });
  }

  /**
   * Renderer's reply. Unknown requestIds are silently ignored so a stale
   * response can't crash main.
   */
  respond(requestId: string, approved: boolean): void {
    const entry = this.pending.get(requestId);
    if (!entry) {
      log("respond id=%s unknown or already resolved — ignoring", requestId);
      return;
    }
    this.pending.delete(requestId);
    clearTimeout(entry.timer);
    log("respond id=%s approved=%s", requestId, approved);
    entry.resolve(approved);
  }

  /** Tear down: reject all pending requests and clear timers. */
  dispose(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      log("dispose: defaulting id=%s to deny", id);
      entry.resolve(false);
    }
    this.pending.clear();
  }
}
