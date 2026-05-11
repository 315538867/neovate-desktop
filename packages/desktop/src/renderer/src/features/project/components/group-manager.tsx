import { PlusIcon } from "lucide-react";
import { useState } from "react";

import type { ProjectGroup } from "../../../../../shared/features/project/types";

import { Button } from "../../../components/ui/button";
import { Spinner } from "../../../components/ui/spinner";
import { GroupDetail } from "./group-detail";

interface GroupManagerProps {
  groups: ProjectGroup[];
  loading: boolean;
  onRefresh: () => void;
}

export function GroupManager({ groups, loading, onRefresh }: GroupManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (creating) {
    return <GroupDetail onBack={() => setCreating(false)} onSaved={onRefresh} />;
  }

  if (editingId) {
    const group = groups.find((g) => g.id === editingId)!;
    return <GroupDetail group={group} onBack={() => setEditingId(null)} onSaved={onRefresh} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">已建 {groups.length} 个分组</h3>
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          <PlusIcon className="size-4 mr-1" />
          新建分组
        </Button>
      </div>

      {loading && groups.length === 0 ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">
          暂无分组，点击"新建分组"创建第一个。
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => (
            <button
              key={group.id}
              className="w-full flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent/50 cursor-pointer"
              onClick={() => setEditingId(group.id)}
            >
              <div>
                <div className="font-medium text-sm">{group.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {group.members.length} 个成员
                </div>
              </div>
              <span className="text-xs text-muted-foreground">编辑</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
