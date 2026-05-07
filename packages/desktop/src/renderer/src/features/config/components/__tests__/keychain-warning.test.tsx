// @vitest-environment jsdom
/**
 * UI test for the keychain unavailable banner (Wave 4.3 commit 7.2).
 *
 * Three states matter:
 *   - keychainAvailable === null   → banner hidden (pre-load)
 *   - keychainAvailable === true   → banner hidden (everything fine)
 *   - keychainAvailable === false  → banner visible (surface to user)
 *
 * Plus: dismissing the banner hides it for the rest of the session.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "keychain.unavailable.title": "OS keychain unavailable",
        "keychain.unavailable.description":
          "Provider API keys cannot be encrypted or read on this system.",
        "keychain.unavailable.dismiss": "Dismiss",
      };
      return map[key] ?? key;
    },
  }),
}));

// The banner reads `keychainAvailable` from useConfigStore. We mock the store
// module to return whatever value the test wants without booting zustand.
const { keychainAvailableHandle } = vi.hoisted(() => ({
  keychainAvailableHandle: { value: null as boolean | null },
}));

vi.mock("../../store", () => ({
  useConfigStore: <T,>(selector: (s: { keychainAvailable: boolean | null }) => T): T =>
    selector({ keychainAvailable: keychainAvailableHandle.value }),
}));

import { KeychainWarningBanner } from "../keychain-warning";

beforeEach(() => {
  keychainAvailableHandle.value = null;
});

afterEach(() => {
  cleanup();
});

describe("KeychainWarningBanner", () => {
  it("renders nothing when keychainAvailable is null (pre-load)", () => {
    keychainAvailableHandle.value = null;
    const { container } = render(<KeychainWarningBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when keychainAvailable is true", () => {
    keychainAvailableHandle.value = true;
    const { container } = render(<KeychainWarningBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the alert when keychainAvailable is false", () => {
    keychainAvailableHandle.value = false;
    render(<KeychainWarningBanner />);
    expect(screen.queryByTestId("keychain-warning-banner")).not.toBeNull();
    expect(screen.queryByText("OS keychain unavailable")).not.toBeNull();
    expect(
      screen.queryByText("Provider API keys cannot be encrypted or read on this system."),
    ).not.toBeNull();
  });

  it("hides the banner after the dismiss button is clicked", () => {
    keychainAvailableHandle.value = false;
    render(<KeychainWarningBanner />);
    expect(screen.queryByTestId("keychain-warning-banner")).not.toBeNull();

    const dismiss = screen.getByLabelText("Dismiss");
    fireEvent.click(dismiss);

    expect(screen.queryByTestId("keychain-warning-banner")).toBeNull();
  });
});
