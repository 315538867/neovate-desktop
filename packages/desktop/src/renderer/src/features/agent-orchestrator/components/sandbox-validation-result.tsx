import { CheckCircle, CancelCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "../../../lib/utils";

type Props = {
  valid: boolean;
  checks: Array<{ check: string; passed: boolean; detail?: string }>;
  className?: string;
};

const checkLabels: Record<string, string> = {
  workspace_path_exists: "Workspace path exists",
  is_git_repo: "Git repository",
  workspace_writable: "Workspace writable",
};

export function SandboxValidationResult({ valid, checks, className }: Props) {
  return (
    <div className={cn("space-y-1", className)} aria-label="Sandbox validation">
      <div className="flex items-center gap-1.5 text-xs">
        {valid ? (
          <HugeiconsIcon icon={CheckCircle} className="size-3 text-green-500" />
        ) : (
          <HugeiconsIcon icon={CancelCircleIcon} className="size-3 text-red-500" />
        )}
        <span className={valid ? "text-green-500" : "text-red-500"}>
          {valid ? "Sandbox valid" : "Sandbox invalid"}
        </span>
      </div>
      <div className="ml-5 space-y-0.5">
        {checks.map((c) => (
          <div key={c.check} className="flex items-center gap-1 text-[11px]">
            {c.passed ? (
              <span className="text-green-500">&#10003;</span>
            ) : (
              <span className="text-red-500">&#10007;</span>
            )}
            <span className="text-muted-foreground">{checkLabels[c.check] ?? c.check}</span>
            {c.detail && <span className="text-muted-foreground/60">{c.detail}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
