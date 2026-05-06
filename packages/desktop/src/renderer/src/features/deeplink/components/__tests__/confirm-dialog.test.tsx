// @vitest-environment jsdom
/**
 * UI test for the deeplink confirm dialog (Wave 4.3 commit 7.3).
 *
 * The contract under test:
 *   - empty queue        → renders nothing
 *   - queue head present → renders the dialog with the URL
 *   - approve button     → calls respondConfirmRequest({ approved: true }) and shifts the queue
 *   - reject  button     → calls respondConfirmRequest({ approved: false }) and shifts the queue
 *
 * The bus-side default-deny-on-timeout is covered by `confirm-bus.test.ts`;
 * here we only verify the renderer's wiring.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeeplinkConfirmRequest } from "../../../../../../shared/features/deeplink/contract";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "deeplink.confirm.title": "Open this deeplink?",
        "deeplink.confirm.description":
          "An external app is asking Neovate to open the link below. Only continue if you started this action.",
        "deeplink.confirm.approve": "Open",
        "deeplink.confirm.reject": "Cancel",
      };
      return map[key] ?? key;
    },
  }),
}));

const { storeHandle, shiftSpy } = vi.hoisted(() => ({
  storeHandle: { queue: [] as DeeplinkConfirmRequest[] },
  shiftSpy: vi.fn(),
}));

vi.mock("../../store", () => ({
  useDeeplinkConfirmStore: <T,>(
    selector: (s: { queue: DeeplinkConfirmRequest[]; shift: () => void }) => T,
  ): T => selector({ queue: storeHandle.queue, shift: shiftSpy }),
}));

const respondMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../../orpc", () => ({
  client: {
    deeplink: {
      respondConfirmRequest: (...args: unknown[]) => respondMock(...args),
    },
  },
}));

vi.mock("../../../../core/error-reporter", () => ({
  reportError: vi.fn(),
}));

import { DeeplinkConfirmDialog } from "../confirm-dialog";

beforeEach(() => {
  storeHandle.queue = [];
  shiftSpy.mockReset();
  respondMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

const sampleRequest: DeeplinkConfirmRequest = {
  requestId: "req-1",
  url: "neovate://session/abc",
  scheme: "neovate",
  host: "session",
};

describe("DeeplinkConfirmDialog (Wave 4.3 commit 7.3)", () => {
  it("renders nothing when the queue is empty", () => {
    storeHandle.queue = [];
    const { container } = render(<DeeplinkConfirmDialog />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the dialog with the head URL when a request is queued", () => {
    storeHandle.queue = [sampleRequest];
    render(<DeeplinkConfirmDialog />);
    expect(screen.queryByTestId("deeplink-confirm-dialog")).not.toBeNull();
    expect(screen.queryByText("Open this deeplink?")).not.toBeNull();
    expect(screen.queryByTestId("deeplink-confirm-url")?.textContent).toBe("neovate://session/abc");
  });

  it("approve button shifts the queue and calls respondConfirmRequest with approved=true", async () => {
    storeHandle.queue = [sampleRequest];
    render(<DeeplinkConfirmDialog />);

    fireEvent.click(screen.getByTestId("deeplink-confirm-approve"));

    expect(shiftSpy).toHaveBeenCalledTimes(1);
    // respond fires asynchronously after the click handler returns; flush microtasks.
    await Promise.resolve();
    expect(respondMock).toHaveBeenCalledWith({
      requestId: "req-1",
      approved: true,
    });
  });

  it("reject button shifts the queue and calls respondConfirmRequest with approved=false", async () => {
    storeHandle.queue = [sampleRequest];
    render(<DeeplinkConfirmDialog />);

    fireEvent.click(screen.getByTestId("deeplink-confirm-reject"));

    expect(shiftSpy).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(respondMock).toHaveBeenCalledWith({
      requestId: "req-1",
      approved: false,
    });
  });
});
