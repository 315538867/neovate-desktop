import { Trash2Icon } from "lucide-react";
import { useCallback, useState } from "react";

import type {
  ProjectGroup,
  ProjectGroupMember,
  ProjectRole,
} from "../../../../../shared/features/project/types";

import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { client } from "../../../orpc";
import { useProjectStore } from "../store";

const ROLES: { value: ProjectRole; label: string }[] = [
  { value: "library", label: "library (库)" },
  { value: "consumer", label: "consumer (消费方)" },
  { value: "shared", label: "shared (共享)" },
  { value: "service", label: "service (服务)" },
  { value: "tool", label: "tool (工具)" },
  { value: "other", label: "other (其他)" },
];

interface GroupDetailProps {
  group?: ProjectGroup;
  onBack: () => void;
  onSaved: () => void;
}

export function GroupDetail({ group, onBack, onSaved }: GroupDetailProps) {
  const isNew = !group;
  const [name, setName] = useState(group?.name ?? "");
  const [members, setMembers] = useState<ProjectGroupMember[]>(group?.members ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allProjects = useProjectStore((s) => s.projects);

  const handleAddMember = useCallback(() => {
    const unadded = allProjects.filter((p) => !members.some((m) => m.projectId === p.id));
    if (unadded.length > 0) {
      setMembers([...members, { projectId: unadded[0]!.id, role: "consumer" as ProjectRole }]);
    }
  }, [allProjects, members]);

  const handleRemoveMember = useCallback(
    (projectId: string) => {
      setMembers(members.filter((m) => m.projectId !== projectId));
    },
    [members],
  );

  const handleRoleChange = useCallback(
    (projectId: string, role: ProjectRole) => {
      setMembers(members.map((m) => (m.projectId === projectId ? { ...m, role } : m)));
    },
    [members],
  );

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setError("请输入分组名称");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        await client.project.groups.create({ name: name.trim(), members });
      } else {
        await client.project.groups.update({ id: group!.id, name: name.trim(), members });
      }
      onSaved();
      onBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [isNew, name, members, group, onSaved, onBack]);

  const handleDelete = useCallback(async () => {
    if (!group) return;
    if (!confirm(`确定删除分组「${group.name}」？`)) return;
    setSaving(true);
    setError(null);
    try {
      await client.project.groups.remove({ id: group.id });
      onSaved();
      onBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败，可能有活跃的组对话。");
    } finally {
      setSaving(false);
    }
  }, [group, onSaved, onBack]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          className="text-sm text-muted-foreground hover:text-foreground cursor-pointer"
          onClick={onBack}
        >
          ← 返回
        </button>
      </div>

      <h3 className="text-base font-semibold">{isNew ? "新建分组" : `编辑「${group!.name}」`}</h3>

      {/* Name */}
      <div className="space-y-1">
        <label className="text-sm text-muted-foreground">名称</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="输入分组名称" />
      </div>

      {/* Members */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm text-muted-foreground">成员 ({members.length})</label>
          <Button variant="ghost" size="sm" onClick={handleAddMember}>
            + 添加项目
          </Button>
        </div>

        {members.length === 0 ? (
          <div className="text-center py-4 text-sm text-muted-foreground border border-dashed rounded-lg">
            拖入项目或点击"+ 添加项目"
          </div>
        ) : (
          <div className="space-y-2">
            {members.map((member) => {
              const project = allProjects.find((p) => p.id === member.projectId);
              return (
                <div
                  key={member.projectId}
                  className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
                >
                  <span className="flex-1 text-sm truncate">
                    {project?.name ?? member.projectId}
                    {project?.pathMissing && <span className="text-warning ml-1">(路径丢失)</span>}
                    {!project && <span className="text-destructive ml-1">(项目已删除)</span>}
                  </span>
                  <Select
                    value={member.role}
                    onValueChange={(v) => handleRoleChange(member.projectId, v as ProjectRole)}
                  >
                    <SelectTrigger className="w-36 h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    className="p-1 text-muted-foreground hover:text-destructive cursor-pointer"
                    onClick={() => handleRemoveMember(member.projectId)}
                  >
                    <Trash2Icon className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <div>
          {!isNew && (
            <Button variant="ghost" size="sm" onClick={handleDelete} disabled={saving}>
              <Trash2Icon className="size-4 mr-1 text-destructive" />
              删除分组
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onBack} disabled={saving}>
            取消
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}
