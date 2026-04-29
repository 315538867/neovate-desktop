import type { ArchitectureDoc } from "../../../../../shared/features/agent-orchestrator/schemas";

import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { cn } from "../../../lib/utils";

type Props = {
  output: ArchitectureDoc;
  className?: string;
};

export function ArchitectureReviewCard({ output, className }: Props) {
  return (
    <Card className={cn("max-h-96 overflow-y-auto", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Architecture Design</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div>
          <span className="font-medium text-muted-foreground">Goal: </span>
          <span>{output.goal}</span>
        </div>

        <div>
          <span className="font-medium text-muted-foreground">Approach: </span>
          <span>{output.approach}</span>
        </div>

        <div className="space-y-1">
          <span className="font-medium text-muted-foreground">Modules:</span>
          <div className="space-y-1">
            {output.modules.map((m) => (
              <div key={m.name} className="flex items-center gap-2 rounded bg-muted/50 px-2 py-1">
                <span className="font-medium">{m.name}</span>
                <span className="text-muted-foreground">{m.path}</span>
                <Badge variant="secondary" className="ml-auto text-[10px]">
                  {m.changes}
                </Badge>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <span className="font-medium text-muted-foreground">Interfaces:</span>
          {output.interfaces.map((iface) => (
            <div key={iface.name} className="rounded bg-muted/50 px-2 py-1">
              <code className="text-[11px]">{iface.signature}</code>
              <p className="text-muted-foreground">{iface.rationale}</p>
            </div>
          ))}
        </div>

        {output.risks.length > 0 && (
          <div className="space-y-0.5">
            <span className="font-medium text-muted-foreground">Risks:</span>
            <ul className="list-inside list-disc space-y-0.5">
              {output.risks.map((r, i) => (
                <li key={i} className="text-muted-foreground">
                  {r}
                </li>
              ))}
            </ul>
          </div>
        )}

        {output.estimatedSubtasks.length > 0 && (
          <div className="space-y-0.5">
            <span className="font-medium text-muted-foreground">Estimated Subtasks:</span>
            <ul className="list-inside list-disc space-y-0.5">
              {output.estimatedSubtasks.map((s, i) => (
                <li key={i} className="text-muted-foreground">
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
