import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import type { DeeplinkConfirmRequest } from "../../../../shared/features/deeplink/contract";

interface DeeplinkConfirmState {
  /**
   * FIFO queue of pending confirm requests. The dialog renders the head
   * (`queue[0]`); user action shifts it off and calls `respondConfirmRequest`.
   * Multiple deeplinks fired in quick succession queue up rather than
   * stacking modals.
   */
  queue: DeeplinkConfirmRequest[];
  enqueue: (request: DeeplinkConfirmRequest) => void;
  shift: () => void;
}

export const useDeeplinkConfirmStore = create<DeeplinkConfirmState>()(
  immer((set) => ({
    queue: [],
    enqueue: (request) =>
      set((state) => {
        state.queue.push(request);
      }),
    shift: () =>
      set((state) => {
        state.queue.shift();
      }),
  })),
);
