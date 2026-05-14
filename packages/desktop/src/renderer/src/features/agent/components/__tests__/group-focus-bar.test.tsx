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

const { mockAddElevatedProject } = vi.hoisted(() => ({
  mockAddElevatedProject: vi.fn(),
}));

vi.mock("../../store", () => ({
  useAgentStore: (selector: any) => {
    if (typeof selector === "function") {
      return selector({
        addElevatedProject: mockAddElevatedProject,
        revokeElevation: vi.fn(),
      });
    }
    return {
      addElevatedProject: mockAddElevatedProject,
      revokeElevation: vi.fn(),
    };
  },
}));

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

vi.mock("../../../../components/ui/popover", () => ({
  Popover: ({ children }: any) => <>{children}</>,
  PopoverTrigger: ({ children, className, title }: any) => (
    <button className={className} title={title} type="button">
      {children}
    </button>
  ),
  PopoverPopup: ({ children }: any) => <div role="menu">{children}</div>,
}));

vi.mock("../../../../lib/utils", () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(" "),
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

  it("renders read-only chip", () => {
    render(<GroupFocusBar session={makeSession()} />);
    const chips = screen.getAllByText("group.readOnlyChip");
    expect(chips.length).toBeGreaterThanOrEqual(1);
  });

  it("renders all members as clickable buttons", () => {
    render(<GroupFocusBar session={makeSession()} />);
    const portalButtons = screen.getAllByText("edu-portal");
    const chipBtn = portalButtons.find(
      (b) => b.tagName === "BUTTON" && !b.closest('[role="menu"]'),
    );
    expect(chipBtn).toBeDefined();
    expect(screen.getByText("edu-design").tagName).toBeTruthy();
  });

  it("shows read-only hint at bottom", () => {
    render(<GroupFocusBar session={makeSession()} />);
    expect(screen.getByText("group.readOnlyHint")).toBeDefined();
  });

  it("calls addElevatedProject when clicking a member chip", () => {
    render(<GroupFocusBar session={makeSession()} />);
    const buttons = screen.getAllByText("edu-design");
    const chipBtn = buttons.find((b) => b.tagName === "BUTTON" && !b.closest('[role="menu"]'));
    expect(chipBtn).toBeDefined();
    fireEvent.click(chipBtn!);
    expect(mockAddElevatedProject).toHaveBeenCalledWith("s1", "p-design");
  });

  it("renders elevated member with unlock icon and opens revoke dialog on click", async () => {
    render(<GroupFocusBar session={makeSession({ elevatedProjectIds: ["p-design"] })} />);
    // Click elevated chip
    const buttons = screen.getAllByText("edu-design");
    const elevatedBtn = buttons.find((b) => b.tagName === "BUTTON" && !b.closest('[role="menu"]'));
    expect(elevatedBtn).toBeDefined();
    fireEvent.click(elevatedBtn!);
    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeDefined();
    });
    expect(screen.getByText("group.revokeElevationTitle")).toBeDefined();
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
