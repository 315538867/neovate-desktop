import { SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";

import type { ProjectInfo } from "../../../../../shared/features/project/types";

import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { cn } from "../../../lib/utils";

interface MemberPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectInfo[];
  /** 已是成员的项目 id（默认勾选 + 禁用） */
  existingMemberIds: string[];
  /** 确认后把新增的 id 一次性回传（不含已存在成员） */
  onConfirm: (newProjectIds: string[]) => void;
}

export function MemberPicker({
  open,
  onOpenChange,
  projects,
  existingMemberIds,
  onConfirm,
}: MemberPickerProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 打开/关闭时重置查询与选择（使用 dialog open 的传入值做驱动）
  const existing = useMemo(() => new Set(existingMemberIds), [existingMemberIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q),
    );
  }, [projects, query]);

  const toggle = (id: string) => {
    if (existing.has(id)) return; // 已存在成员禁止操作
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = () => {
    if (selected.size === 0) {
      onOpenChange(false);
      return;
    }
    onConfirm(Array.from(selected));
    setSelected(new Set());
    setQuery("");
    onOpenChange(false);
  };

  const handleCancel = () => {
    setSelected(new Set());
    setQuery("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : handleCancel())}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>选择项目加入分组</DialogTitle>
        </DialogHeader>

        <DialogPanel>
          <div className="space-y-3">
            <div className="relative">
              <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="搜索项目名或路径"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
            </div>

            {filtered.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {projects.length === 0 ? "暂无项目" : "没有匹配的项目"}
              </div>
            ) : (
              <div className="space-y-1 max-h-[320px] overflow-y-auto">
                {filtered.map((p) => {
                  const already = existing.has(p.id);
                  const checked = already || selected.has(p.id);
                  return (
                    <label
                      key={p.id}
                      data-test-id="member-picker-item"
                      className={cn(
                        "flex items-start gap-3 p-2 rounded-md transition-colors",
                        already
                          ? "opacity-60 cursor-not-allowed"
                          : checked
                            ? "bg-accent cursor-pointer"
                            : "cursor-pointer hover:bg-accent/50",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={already}
                        onCheckedChange={() => toggle(p.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground truncate">
                            {p.name}
                          </span>
                          {already && (
                            <span className="text-[10px] text-muted-foreground">已在组内</span>
                          )}
                          {p.pathMissing && (
                            <span className="text-[10px] text-warning">路径丢失</span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{p.path}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </DialogPanel>

        <DialogFooter variant="bare">
          <div className="flex items-center justify-between w-full">
            <span className="text-xs text-muted-foreground">
              已选 {selected.size} 个（可一次添加多个）
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleCancel}>
                取消
              </Button>
              <Button
                data-test-id="member-picker-confirm"
                size="sm"
                onClick={handleConfirm}
                disabled={selected.size === 0}
              >
                添加 {selected.size} 个项目
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
