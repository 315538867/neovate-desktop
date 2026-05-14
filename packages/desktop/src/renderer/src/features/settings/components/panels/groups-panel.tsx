import { Info } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { GroupDetail } from "../../../project/components/group-detail";
import { GroupManager } from "../../../project/components/group-manager";
import { useGroupsStore } from "../../../project/store";

export const GroupsPanel = () => {
  const { t } = useTranslation();
  const { groups, loading, loadGroups } = useGroupsStore();

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Info className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">{t("settings.groups")}</h2>
      </div>

      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground space-y-2">
        <p className="font-medium text-foreground/80">
          分组让一组关联项目在"组对话"中同时可见，AI 可以自由探索组内所有项目的代码。
        </p>
        <ul className="list-disc pl-4 space-y-1">
          <li>创建分组后，可在项目选择器中通过"+ 新建会话 → 在分组里聊"开启组对话。</li>
          <li>
            组对话有"聚焦项目"概念：
            <strong>写操作（Edit/Write/MultiEdit/NotebookEdit）默认仅作用于当前聚焦项目</strong>。
          </li>
          <li>其他成员项目对 Read/Grep/Glob 完全开放，AI 可主动跨项目探索代码关系。</li>
          <li>切换聚焦项目：点击组对话顶部的成员 chip 即可（无需重启对话）。</li>
          <li>
            分组只记录成员项目和可选的角色文本（自由填写、可留空），用于在 AI 提示中给出语义提示。
          </li>
          <li>删除项目不会自动从分组中移除，成员将标记为"路径丢失"，可在这里手动清理。</li>
        </ul>
      </div>

      <GroupManager groups={groups} loading={loading} onRefresh={loadGroups} />
    </div>
  );
};

export { GroupDetail };
