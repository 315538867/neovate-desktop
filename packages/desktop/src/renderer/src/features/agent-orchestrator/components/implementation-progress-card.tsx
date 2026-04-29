import type {
  ImplementationResult,
  SubtaskRecord,
} from "../../../../../shared/features/agent-orchestrator/schemas";

import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { cn } from "../../../lib/utils";
import { SubtaskTable } from "./subtask-table";

type Props = {
  output?: ImplementationResult;
  subtasks: SubtaskRecord[];
  className?: string;
};

const statusBadge: Record<string, { label: string; className: string }> = {
  success: { label: "Success", className: "border-green-500/30 text-green-500" },
  partial: { label: "Partial", className: "border-yellow-400/30 text-yellow-400" },
  failed: { label: "Failed", className: "border-red-500/30 text-red-500" },
};

export function ImplementationProgressCard({ output, subtasks, className }: Props) {
  const summary = output?.status;

  return (
    <Card className={cn(className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Implementation Progress</CardTitle>
          {summary && (
            <Badge
              variant="secondary"
              className={cn("text-[10px]", statusBadge[summary]?.className)}
            >
              {statusBadge[summary]?.label ?? summary}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <SubtaskTable subtasks={subtasks} />

        {output?.filesChanged && output.filesChanged.length > 0 && (
          <div className="space-y-1">
            <span className="text-[10px] font-medium text-muted-foreground">
              Files Changed ({output.filesChanged.length})
            </span>
            <div className="space-y-0.5">
              {output.filesChanged.map((fc) => (
                <div
                  key={fc.path}
                  className="flex items-center gap-1.5 rounded bg-muted/50 px-2 py-0.5 text-[11px]"
                >
                  <Badge variant="secondary" className="text-[9px]">
                    {fc.operation}
                  </Badge>
                  <code className="truncate">{fc.path}</code>
                </div>
              ))}
            </div>
          </div>
        )}

        {output?.summary && <p className="text-xs text-muted-foreground">{output.summary}</p>}

        {output?.unresolvedIssues && output.unresolvedIssues.length > 0 && (
          <div className="space-y-0.5">
            <span className="text-[10px] font-medium text-red-400">Unresolved Issues</span>
            <ul className="list-inside list-disc space-y-0.5 text-[11px] text-red-400/80">
              {output.unresolvedIssues.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
