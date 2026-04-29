import type { PipelineRun } from "../../../../../shared/features/agent-orchestrator/schemas";

import { cn } from "../../../lib/utils";
import { useOrchestratorStore } from "../store";
import { StageCard } from "./stage-card";

type Props = {
  run: PipelineRun;
  className?: string;
};

const stageLabelMap: Record<string, string> = {
  architect: "Architect",
  reviewer: "Reviewer",
  implementer: "Implementer",
  validator: "Validator",
};

export function PipelineTimeline({ run, className }: Props) {
  const expandedStageId = useOrchestratorStore((s) => s.expandedStageId);
  const setExpandedStageId = useOrchestratorStore((s) => s.setExpandedStageId);

  // 按依赖关系排序
  const ordered = run.stageRuns.slice();

  const activeStage = ordered.find((s) => s.status === "running");

  return (
    <div className={cn("space-y-1", className)} aria-label="Pipeline timeline">
      {ordered.map((stage) => {
        const label = stageLabelMap[stage.stageId] ?? stage.stageId;
        return (
          <StageCard
            key={stage.instanceId}
            stage={stage}
            stageLabel={label}
            isActive={activeStage?.instanceId === stage.instanceId}
            isExpanded={expandedStageId === stage.instanceId}
            onExpand={() =>
              setExpandedStageId(expandedStageId === stage.instanceId ? null : stage.instanceId)
            }
          />
        );
      })}
    </div>
  );
}
