import { Trash2Icon } from "lucide-react";
import { useCallback, useState } from "react";

import type {
  ProjectGroup,
  ProjectGroupMember,
} from "../../../../../shared/features/project/types";

import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { client } from "../../../orpc";
import { useProjectStore } from "../store";
import { MemberPicker } from "./member-picker";

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
  const [pickerOpen, setPickerOpen] = useState(false);

  const allProjects = useProjectStore((s) => s.projects);

  const handlePickerConfirm = useCallback(
    (newIds: string[]) => {
      // 保留原有成员 role / 顺序，新成员追加在末尾，role 默认 undefined
      const additions = newIds
        .filter((id) => !members.some((m) => m.projectId === id))
        .map<ProjectGroupMember>((id) => ({ projectId: id, role: undefined }));
      setMembers([...members, ...additions]);
    },
    [members],
  );

  const handleRemoveMember = useCallback(
    (projectId: string) => {
      setMembers(members.filter((m) => m.projectId !== projectId));
    },
    [members],
  );

  const handleRoleChange = useCallback(
    (projectId: string, role: string) => {
      const trimmed = role.trim();
      setMembers(
        members.map((m) =>
          m.projectId === projectId ? { ...m, role: trimmed ? trimmed : undefined } : m,
        ),
      );
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
        <Input
          data-test-id="group-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="输入分组名称"
        />
      </div>

      {/* Members */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm text-muted-foreground">成员 ({members.length})</label>
          <Button variant="ghost" size="sm" onClick={() => setPickerOpen(true)}>
            + 添加项目
          </Button>
        </div>

        {members.length === 0 ? (
          <div className="text-center py-4 text-sm text-muted-foreground border border-dashed rounded-lg">
            点击 "+ 添加项目" 选择项目加入分组
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
                  <Input
                    className="w-44 h-7 text-xs"
                    placeholder="角色（可选）"
                    maxLength={60}
                    value={member.role ?? ""}
                    onChange={(e) => handleRoleChange(member.projectId, e.target.value)}
                  />
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
          <Button data-test-id="group-save-btn" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </div>
      </div>

      <MemberPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        projects={allProjects}
        existingMemberIds={members.map((m) => m.projectId)}
        onConfirm={handlePickerConfirm}
      />
    </div>
  );
}
