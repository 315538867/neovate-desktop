import { useTranslation } from "react-i18next";

import type { SkillSource } from "../../../../../shared/features/skills/types";

import { cn } from "../../../lib/utils";

/**
 * Filter value: a SkillSource string, "user" for skills with no InstallMeta
 * (user-authored / pre-Wave-4.2 imports), or "all" for no filter.
 */
export type SourceFilterValue = SkillSource | "user" | "all";

interface SourceFilterProps {
  value: SourceFilterValue;
  onChange: (value: SourceFilterValue) => void;
  /** Per-source counts; absent keys render "0" in the chip. */
  counts?: Partial<Record<SourceFilterValue, number>>;
  disabled?: boolean;
  className?: string;
}

const ORDER: SourceFilterValue[] = ["all", "git", "npm", "clawhub", "prebuilt", "user"];

const LABEL_KEY = {
  all: "settings.skills.sourceAll",
  git: "settings.skills.sourceGit",
  npm: "settings.skills.sourceNpm",
  clawhub: "settings.skills.sourceClawhub",
  prebuilt: "settings.skills.sourcePrebuilt",
  user: "settings.skills.sourceUser",
} as const satisfies Record<SourceFilterValue, string>;

/**
 * Chip-style filter for the Installed-skills list. Mirrors {@link ToggleOptions}
 * shape but lets us suppress chips whose count is 0 (clutter) and inline the count
 * into the label.
 */
export function SourceFilter({ value, onChange, counts, disabled, className }: SourceFilterProps) {
  const { t } = useTranslation();
  return (
    <div className={cn("flex flex-wrap gap-1 bg-muted rounded-lg p-1", className)}>
      {ORDER.map((source) => {
        const count = counts?.[source];
        // Hide non-"all" chips whose count is 0 — keeps the bar uncluttered when a
        // user only has skills from a single source. "all" is always visible.
        if (source !== "all" && counts && (count ?? 0) === 0) return null;
        const active = value === source;
        return (
          <button
            key={source}
            type="button"
            disabled={disabled}
            onClick={() => onChange(source)}
            className={cn(
              "px-2.5 py-1 text-xs font-medium rounded-md transition-colors border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
              active
                ? "bg-background text-foreground border-border"
                : "bg-transparent text-muted-foreground border-transparent hover:bg-accent",
            )}
          >
            {t(LABEL_KEY[source])}
            {count !== undefined && (
              <span className="ml-1.5 text-[10px] tabular-nums opacity-70">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
