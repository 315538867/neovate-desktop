import debug from "debug";
import { ArrowUpCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  InstalledPlugin,
  PluginUpdate,
} from "../../../../../shared/features/claude-code-plugins/types";
import type { Project } from "../../../../../shared/features/project/types";

import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Spinner } from "../../../components/ui/spinner";
import { Switch } from "../../../components/ui/switch";
import { client } from "../../../orpc";
import { PluginDetailModal } from "./plugin-detail-modal";

const log = debug("neovate:plugins");

const getInitials = (name: string): string => {
  const words = name.split(/[\s-_]+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

interface InstalledTabProps {
  plugins: InstalledPlugin[];
  updates: PluginUpdate[];
  projects: Project[];
  onRefresh: () => Promise<void>;
}

export const InstalledTab = ({ plugins, updates, projects, onRefresh }: InstalledTabProps) => {
  const { t } = useTranslation();
  const [selectedPlugin, setSelectedPlugin] = useState<InstalledPlugin | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [updatingAll, setUpdatingAll] = useState(false);

  const getUpdate = (plugin: InstalledPlugin) =>
    updates.find((u) => u.pluginId === plugin.pluginId && u.scope === plugin.scope);

  const handleToggle = async (plugin: InstalledPlugin) => {
    const key = `${plugin.pluginId}-${plugin.scope}`;
    if (togglingId) return;
    setTogglingId(key);
    log("toggle plugin: %s enabled=%s", plugin.pluginId, !plugin.enabled);
    try {
      if (plugin.enabled) {
        await client.plugins.disable({ pluginId: plugin.pluginId });
      } else {
        await client.plugins.enable({ pluginId: plugin.pluginId });
      }
      await onRefresh();
    } finally {
      setTogglingId(null);
    }
  };

  const handleUpdateAll = async () => {
    setUpdatingAll(true);
    try {
      await client.plugins.updateAll({});
      await onRefresh();
    } finally {
      setUpdatingAll(false);
    }
  };

  if (plugins.length === 0) {
    return (
      <div className="rounded-xl bg-card/60 border border-border/30 py-8">
        <p className="text-sm text-muted-foreground text-center">
          {t("settings.plugins.noPluginsInstalled")}
        </p>
      </div>
    );
  }

  return (
    <>
      {updates.length > 0 && (
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm text-muted-foreground">
            {t("settings.plugins.updatesAvailable", { count: updates.length })}
          </span>
          <Button variant="outline" size="sm" onClick={handleUpdateAll} disabled={updatingAll}>
            {updatingAll ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />}
            {t("settings.plugins.updateAll")}
          </Button>
        </div>
      )}

      <div className="rounded-xl bg-card border border-border/50 divide-y divide-border/50">
        {plugins.map((plugin) => {
          const key = `${plugin.pluginId}-${plugin.scope}`;
          const initials = getInitials(plugin.name);
          const update = getUpdate(plugin);
          return (
            <div
              key={key}
              className="group relative flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors duration-150 first:rounded-t-xl last:rounded-b-xl"
              onClick={() => setSelectedPlugin(plugin)}
            >
              <div className="flex items-center justify-center size-8 rounded-md bg-muted text-muted-foreground text-xs font-semibold shrink-0">
                {initials}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-foreground truncate">{plugin.name}</h3>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" size="sm">
                      {plugin.scope === "user"
                        ? t("settings.plugins.user")
                        : `${plugin.scope}: ${plugin.projectPath?.split("/").pop() ?? t("settings.plugins.unknown")}`}
                    </Badge>
                    {plugin.version && (
                      <Badge variant="secondary" size="sm">
                        v{plugin.version}
                      </Badge>
                    )}
                    {update && (
                      <Badge variant="default" size="sm" className="gap-1">
                        <ArrowUpCircle className="size-3" />
                        {t("settings.plugins.update")}
                      </Badge>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {plugin.description || t("settings.plugins.noDescription")}
                </p>
              </div>

              <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                <Switch
                  checked={plugin.enabled}
                  disabled={togglingId !== null}
                  onCheckedChange={() => handleToggle(plugin)}
                />
              </div>
            </div>
          );
        })}
      </div>

      {selectedPlugin && (
        <PluginDetailModal
          installedPlugin={
            plugins.find(
              (p) => p.pluginId === selectedPlugin.pluginId && p.scope === selectedPlugin.scope,
            ) ?? selectedPlugin
          }
          update={getUpdate(selectedPlugin)}
          projects={projects}
          onClose={() => setSelectedPlugin(null)}
          onRefresh={onRefresh}
        />
      )}
    </>
  );
};
