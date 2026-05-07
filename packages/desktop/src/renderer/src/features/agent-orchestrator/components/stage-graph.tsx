/**
 * StageGraph — linearized DAG visualization of stage executions.
 *
 * Wave 3.4 step 1 keeps this simple: walk the template's `stages` order,
 * render each as a node with status / duration / error, and overlay any
 * fan-out branches inline. A future revision can promote this to a
 * proper graph layout (dagre) once we have multiple branching templates
 * to validate against.
 */

import type { ComponentProps } from "react";

import { CheckCircle2, CircleDashed, Loader2, OctagonX, SkipForward, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import type {
  PipelineTemplate,
  Run,
  StageExecution,
  StageStatus,
} from "../../../../../shared/features/agent-orchestrator/types";

import { Badge } from "../../../components/ui/badge";
import { cn } from "../../../lib/utils";

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

const STATUS_VARIANT: Record<StageStatus, BadgeVariant> = {
  pending: "outline",
  running: "info",
  succeeded: "success",
  failed: "error",
  skipped: "secondary",
  cancelled: "secondary",
};

const STATUS_ICON: Record<StageStatus, React.ComponentType<{ className?: string }>> = {
  pending: CircleDashed,
  running: Loader2,
  succeeded: CheckCircle2,
  failed: OctagonX,
  skipped: SkipForward,
  cancelled: XCircle,
};

export interface StageGraphProps {
  run: Run;
  template: PipelineTemplate | null;
}

function executionsForStage(run: Run, stageId: string): StageExecution[] {
  return run.executions
    .filter((e) => e.stageId === stageId)
    .sort((a, b) => a.branchIndex - b.branchIndex);
}

function formatDuration(start?: number, end?: number): string | null {
  if (start == null) return null;
  const finish = end ?? Date.now();
  const ms = Math.max(0, finish - start);
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${Math.round(sec % 60)}s`;
}

function StageRow({
  label,
  execution,
  isCurrent,
}: {
  label: string;
  execution: StageExecution;
  isCurrent: boolean;
}) {
  const { t } = useTranslation();
  const Icon = STATUS_ICON[execution.status];
  const duration = formatDuration(execution.startedAt, execution.completedAt);
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md border border-transparent px-3 py-2 transition-colors",
        isCurrent && "border-primary/30 bg-primary/5",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          execution.status === "running" && "animate-spin text-info-foreground",
          execution.status === "succeeded" && "text-success-foreground",
          execution.status === "failed" && "text-destructive-foreground",
          execution.status === "pending" && "text-muted-foreground",
          execution.status === "skipped" && "text-muted-foreground",
          execution.status === "cancelled" && "text-muted-foreground",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-foreground">{label}</span>
          <Badge size="sm" variant={STATUS_VARIANT[execution.status]}>
            {t(`orchestrator.stage.status.${execution.status}`)}
          </Badge>
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
          {execution.branchIndex > 0 && (
            <span>{t("orchestrator.stage.branchLabel", { index: execution.branchIndex })}</span>
          )}
          {duration && <span>{duration}</span>}
          {execution.usage?.usedTokens ? (
            <span>{execution.usage.usedTokens.toLocaleString()} tokens</span>
          ) : null}
        </div>
        {execution.error && (
          <p className="mt-1 text-xs text-destructive-foreground">
            {execution.error.level} · {execution.error.message}
          </p>
        )}
        {execution.output?.summary && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {execution.output.summary}
          </p>
        )}
      </div>
    </div>
  );
}

export function StageGraph({ run, template }: StageGraphProps) {
  const { t } = useTranslation();
  const stages = template?.stages ?? [];
  if (stages.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("orchestrator.stage.unavailable")}</p>;
  }

  return (
    <div className="space-y-2">
      {stages.map((stage) => {
        const executions = executionsForStage(run, stage.id);
        const label = stage.label ?? stage.id;
        const isCurrent = run.currentStageId === stage.id;

        if (executions.length === 0) {
          // No execution yet — render a pending placeholder so the user sees
          // the full pipeline shape upfront.
          const placeholder: StageExecution = {
            stageId: stage.id,
            branchIndex: 0,
            status: "pending",
          };
          return (
            <StageRow key={stage.id} label={label} execution={placeholder} isCurrent={isCurrent} />
          );
        }

        if (executions.length === 1) {
          return (
            <StageRow
              key={`${stage.id}#0`}
              label={label}
              execution={executions[0]}
              isCurrent={isCurrent}
            />
          );
        }

        return (
          <div key={stage.id} className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span>{label}</span>
              <span className="text-[10px] font-normal">
                {t("orchestrator.stage.branchCount", { count: executions.length })}
              </span>
            </div>
            <div className="space-y-1 pl-3">
              {executions.map((exec) => (
                <StageRow
                  key={`${stage.id}#${exec.branchIndex}`}
                  label={`${label} · ${t("orchestrator.stage.branchLabel", { index: exec.branchIndex })}`}
                  execution={exec}
                  isCurrent={isCurrent}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
