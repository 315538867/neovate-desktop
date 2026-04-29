import { CheckCircle, CancelCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { AcceptanceReport } from "../../../../../shared/features/agent-orchestrator/schemas";

import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Meter } from "../../../components/ui/meter";
import { cn } from "../../../lib/utils";

type Props = {
  report: AcceptanceReport;
  className?: string;
};

const decisionConfig: Record<string, { label: string; className: string; icon: React.ReactNode }> =
  {
    accepted: {
      label: "Accepted",
      className: "border-green-500/30 text-green-500",
      icon: <HugeiconsIcon icon={CheckCircle} className="size-3" />,
    },
    rejected: {
      label: "Rejected",
      className: "border-red-500/30 text-red-500",
      icon: <HugeiconsIcon icon={CancelCircleIcon} className="size-3" />,
    },
    accepted_with_followups: {
      label: "Accepted (Follow-ups)",
      className: "border-yellow-400/30 text-yellow-400",
      icon: <HugeiconsIcon icon={CheckCircle} className="size-3" />,
    },
  };

export function ValidationReportCard({ report, className }: Props) {
  const cfg = decisionConfig[report.decision] ?? decisionConfig.rejected;

  return (
    <Card className={cn(className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Validation Report</CardTitle>
          <Badge
            variant="secondary"
            className={cn("flex items-center gap-1 text-[10px]", cfg.className)}
          >
            {cfg.icon}
            {cfg.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Score:</span>
          <span className="font-medium">{report.score}/10</span>
          <Meter
            value={report.score * 10}
            className="flex-1"
            aria-label={`Score ${report.score} out of 10`}
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Matches Architecture:</span>
          {report.matchesArchitecture ? (
            <Badge variant="secondary" className="border-green-500/30 text-green-500 text-[10px]">
              Yes
            </Badge>
          ) : (
            <Badge variant="secondary" className="border-red-500/30 text-red-500 text-[10px]">
              No
            </Badge>
          )}
        </div>

        {report.defects.length > 0 && (
          <div className="space-y-1">
            <span className="text-[10px] font-medium text-muted-foreground">
              Defects ({report.defects.length})
            </span>
            <div className="space-y-1">
              {report.defects.map((d, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded px-2 py-1",
                    d.severity === "blocker" && "bg-red-500/10",
                    d.severity === "major" && "bg-yellow-400/10",
                    d.severity === "minor" && "bg-muted/30",
                  )}
                >
                  <div className="flex items-center gap-1">
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-[9px]",
                        d.severity === "blocker" && "border-red-500/30 text-red-500",
                        d.severity === "major" && "border-yellow-400/30 text-yellow-400",
                      )}
                    >
                      {d.severity}
                    </Badge>
                    {d.file && <code className="text-[10px]">{d.file}</code>}
                  </div>
                  <p className="mt-0.5 text-muted-foreground">{d.problem}</p>
                  <p className="text-muted-foreground/70">{d.fixHint}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {report.followups.length > 0 && (
          <div className="space-y-0.5">
            <span className="text-[10px] font-medium text-muted-foreground">Follow-ups</span>
            <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
              {report.followups.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
