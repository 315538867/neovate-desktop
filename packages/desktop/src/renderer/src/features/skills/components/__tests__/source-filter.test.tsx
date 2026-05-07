// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type SourceFilterValue, SourceFilter } from "../source-filter";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "settings.skills.sourceAll": "All sources",
        "settings.skills.sourceGit": "Git",
        "settings.skills.sourceNpm": "npm",
        "settings.skills.sourceClawhub": "Clawhub",
        "settings.skills.sourcePrebuilt": "Prebuilt",
        "settings.skills.sourceUser": "Local",
      };
      return map[key] ?? key;
    },
  }),
}));

afterEach(() => {
  cleanup();
});

describe("SourceFilter", () => {
  it("renders only the 'all' chip when counts is empty (no skills)", () => {
    const onChange = vi.fn();
    render(<SourceFilter value="all" onChange={onChange} counts={{ all: 0 }} />);
    expect(screen.queryByText("All sources")).not.toBeNull();
    // None of the per-source chips should appear
    expect(screen.queryByText("Git")).toBeNull();
    expect(screen.queryByText("npm")).toBeNull();
    expect(screen.queryByText("Clawhub")).toBeNull();
    expect(screen.queryByText("Prebuilt")).toBeNull();
    expect(screen.queryByText("Local")).toBeNull();
  });

  it("hides chips for sources with zero count and shows non-zero ones", () => {
    render(
      <SourceFilter
        value="all"
        onChange={vi.fn()}
        counts={{ all: 3, git: 2, npm: 1, clawhub: 0, prebuilt: 0, user: 0 }}
      />,
    );
    expect(screen.queryByText("All sources")).not.toBeNull();
    expect(screen.queryByText("Git")).not.toBeNull();
    expect(screen.queryByText("npm")).not.toBeNull();
    expect(screen.queryByText("Clawhub")).toBeNull();
    expect(screen.queryByText("Prebuilt")).toBeNull();
    expect(screen.queryByText("Local")).toBeNull();
  });

  it("renders all chips when no counts prop is provided", () => {
    render(<SourceFilter value="all" onChange={vi.fn()} />);
    expect(screen.queryByText("All sources")).not.toBeNull();
    expect(screen.queryByText("Git")).not.toBeNull();
    expect(screen.queryByText("npm")).not.toBeNull();
    expect(screen.queryByText("Clawhub")).not.toBeNull();
    expect(screen.queryByText("Prebuilt")).not.toBeNull();
    expect(screen.queryByText("Local")).not.toBeNull();
  });

  it("calls onChange with the clicked source value", () => {
    const onChange = vi.fn<(v: SourceFilterValue) => void>();
    render(
      <SourceFilter
        value="all"
        onChange={onChange}
        counts={{ all: 5, git: 3, npm: 2, clawhub: 0, prebuilt: 0, user: 0 }}
      />,
    );
    fireEvent.click(screen.getByText("Git"));
    expect(onChange).toHaveBeenCalledWith("git");
    fireEvent.click(screen.getByText("npm"));
    expect(onChange).toHaveBeenLastCalledWith("npm");
  });

  it("highlights the active chip via the bg-background class", () => {
    const { rerender } = render(
      <SourceFilter
        value="git"
        onChange={vi.fn()}
        counts={{ all: 5, git: 3, npm: 2, clawhub: 0, prebuilt: 0, user: 0 }}
      />,
    );
    const gitChip = screen.getByText("Git").closest("button");
    expect(gitChip?.className).toContain("bg-background");

    rerender(
      <SourceFilter
        value="npm"
        onChange={vi.fn()}
        counts={{ all: 5, git: 3, npm: 2, clawhub: 0, prebuilt: 0, user: 0 }}
      />,
    );
    expect(screen.getByText("Git").closest("button")?.className).not.toContain("bg-background");
    expect(screen.getByText("npm").closest("button")?.className).toContain("bg-background");
  });

  it("inlines counts next to the label when provided", () => {
    render(
      <SourceFilter
        value="all"
        onChange={vi.fn()}
        counts={{ all: 7, git: 4, npm: 0, clawhub: 0, prebuilt: 0, user: 3 }}
      />,
    );
    expect(screen.getByText("All sources").closest("button")?.textContent).toContain("7");
    expect(screen.getByText("Git").closest("button")?.textContent).toContain("4");
    expect(screen.getByText("Local").closest("button")?.textContent).toContain("3");
  });

  it("respects the disabled prop on every chip", () => {
    render(
      <SourceFilter
        value="all"
        onChange={vi.fn()}
        counts={{ all: 1, git: 1, npm: 0, clawhub: 0, prebuilt: 0, user: 0 }}
        disabled
      />,
    );
    expect(screen.getByText("All sources").closest("button")?.disabled).toBe(true);
    expect(screen.getByText("Git").closest("button")?.disabled).toBe(true);
  });
});
