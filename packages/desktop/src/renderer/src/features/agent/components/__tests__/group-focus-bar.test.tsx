// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatSession } from "../../store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, number | string>) => {
      if (params) {
        return key.replace(/\{\{(\w+)\}\}/g, (_, k) => String(params[k] ?? ""));
      }
      return key;
    },
  }),
}));

const { mockSetFocusProject, mockClientSetFocusProject } = vi.hoisted(() => ({
  mockSetFocusProject: vi.fn(),
  mockClientSetFocusProject: vi.fn(),
}));

vi.mock("../../store", () => ({
  useAgentStore: (selector: any) => {
    if (typeof selector === "function") {
      return selector({ setFocusProject: mockSetFocusProject });
    }
    return { setFocusProject: mockSetFocusProject };
  },
}));

vi.mock("../../../../orpc", () => ({
  client: {
    agent: {
      session: {
        setFocusProject: mockClientSetFocusProject,
      },
    },
  },
}));

// Mock AlertDialog to render children inline (base-ui portal has issues in jsdom)
vi.mock("../../../../components/ui/alert-dialog", () => ({
  AlertDialog: ({ children, open }: any) => (open ? <>{children}</> : null),
  AlertDialogClose: ({ children }: any) => <>{children}</>,
  AlertDialogDescription: ({ children, className }: any) => (
    <div className={className}>{children}</div>
  ),
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogPopup: ({ children }: any) => <div role="alertdialog">{children}</div>,
  AlertDialogTitle: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("../../../project/store", () => ({
  useGroupsStore: (selector: any) => {
    if (typeof selector === "function") {
      return selector({
        groups: [
          {
            id: "g-edu",
            name: "Edu",
            members: [
              { projectId: "p-portal", role: "consumer", name: "edu-portal" },
              { projectId: "p-design", role: "library", name: "edu-design" },
            ],
          },
        ],
      });
    }
    return [];
  },
  useProjectStore: (selector: any) => {
    if (typeof selector === "function") {
      return selector({
        projects: [
          { id: "p-portal", name: "edu-portal", path: "/code/edu-portal" },
          { id: "p-design", name: "edu-design", path: "/code/edu-design" },
        ],
      });
    }
    return [];
  },
}));

import { GroupFocusBar } from "../group-focus-bar";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeSession(overrides?: Partial<ChatSession>): ChatSession {
  return {
    sessionId: "s1",
    kind: "group",
    groupId: "g-edu",
    focusProjectId: "p-portal",
    title: "Test Group Session",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    model: "",
    providerId: "",
    messages: [],
    ...overrides,
  } as ChatSession;
}

describe("GroupFocusBar", () => {
  it("renders group name", () => {
    render(<GroupFocusBar session={makeSession()} />);
    expect(screen.getByText("Edu")).toBeDefined();
  });

  it("renders focus project chip", () => {
    render(<GroupFocusBar session={makeSession()} />);
    expect(screen.getByText("edu-portal")).toBeDefined();
  });

  it("renders other member as clickable button", () => {
    render(<GroupFocusBar session={makeSession()} />);
    const chip = screen.getByText("edu-design");
    // Non-focus members are rendered as <button> elements
    expect(chip.tagName).toBe("BUTTON");
    expect(chip.getAttribute("type")).toBe("button");
  });

  it("opens confirmation dialog when clicking other member", async () => {
    render(<GroupFocusBar session={makeSession()} />);
    fireEvent.click(screen.getByText("edu-design"));

    await waitFor(() => {
      const dialog = screen.getByRole("alertdialog");
      expect(dialog).toBeDefined();
    });
  });

  it("renders dialog with confirm and cancel buttons", async () => {
    render(<GroupFocusBar session={makeSession()} />);
    fireEvent.click(screen.getByText("edu-design"));

    await waitFor(() => {
      const dialog = screen.getByRole("alertdialog");
      expect(dialog).toBeDefined();
      // The dialog should have at least 2 buttons (cancel + confirm)
      const buttons = dialog.querySelectorAll("button");
      expect(buttons.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("calls setFocusProject on confirm", async () => {
    mockClientSetFocusProject.mockResolvedValue(undefined);

    render(<GroupFocusBar session={makeSession()} />);
    fireEvent.click(screen.getByText("edu-design"));

    // Wait for the dialog buttons to appear
    const dialog = await screen.findByRole("alertdialog");
    const buttons = dialog.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThanOrEqual(2);

    // Click the confirm button (last one)
    fireEvent.click(buttons[buttons.length - 1]);

    // setFocusProject should be called synchronously on click
    expect(mockSetFocusProject).toHaveBeenCalledWith("s1", "p-design");

    await waitFor(() => {
      expect(mockClientSetFocusProject).toHaveBeenCalledWith({
        sessionId: "s1",
        projectId: "p-design",
      });
    });
  });

  it("reverts focus on setFocusProject failure", async () => {
    mockClientSetFocusProject.mockRejectedValue(new Error("Network error"));

    render(<GroupFocusBar session={makeSession()} />);
    fireEvent.click(screen.getByText("edu-design"));

    const dialog = await screen.findByRole("alertdialog");
    const buttons = dialog.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThanOrEqual(2);

    // Click the confirm button
    fireEvent.click(buttons[buttons.length - 1]);

    // Optimistic update should happen synchronously
    expect(mockSetFocusProject).toHaveBeenCalledWith("s1", "p-design");

    // Wait for the revert (async catch block)
    await waitFor(() => {
      expect(mockSetFocusProject).toHaveBeenCalledWith("s1", "p-portal");
    });
  });

  it("does not render for single session", () => {
    const { container } = render(
      <GroupFocusBar session={makeSession({ kind: "single", groupId: undefined } as any)} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("does not render when group not found", () => {
    const { container } = render(
      <GroupFocusBar session={makeSession({ groupId: "g-nonexistent" })} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
