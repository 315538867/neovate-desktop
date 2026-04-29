import type { SubtaskRecord } from "../../../../../shared/features/agent-orchestrator/schemas";

import { cn } from "../../../lib/utils";

type Props = {
  subtasks: SubtaskRecord[];
  className?: string;
};

const statusConfig: Record<SubtaskRecord["status"], { label: string; className: string }> = {
  running: { label: "Running", className: "text-yellow-400" },
  done: { label: "Done", className: "text-green-500" },
  failed: { label: "Failed", className: "text-red-500" },
  skipped: { label: "Skipped", className: "text-muted-foreground" },
};

export function SubtaskTable({ subtasks, className }: Props) {
  if (subtasks.length === 0) {
    return <p className="px-4 py-2 text-xs text-muted-foreground">No subtasks recorded.</p>;
  }

  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-xs" aria-label="Subtasks">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="px-3 py-1.5 font-medium">Task</th>
            <th className="px-3 py-1.5 font-medium">Status</th>
            <th className="px-3 py-1.5 font-medium">Retries</th>
          </tr>
        </thead>
        <tbody>
          {subtasks.map((st) => {
            const cfg = statusConfig[st.status];
            return (
              <tr key={st.taskId} className="border-b border-border/50">
                <td className="max-w-[200px] truncate px-3 py-1.5">{st.description}</td>
                <td className={cn("px-3 py-1.5 font-medium", cfg.className)}>{cfg.label}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{st.retryCount}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
