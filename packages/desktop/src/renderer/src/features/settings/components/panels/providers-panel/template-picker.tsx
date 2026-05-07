/**
 * Provider template picker grid.
 *
 * Pure presentational component extracted from providers-panel.tsx. Receives
 * sorted templates + which built-in IDs are already in use; emits selection
 * events back to the parent.
 */
import { useTranslation } from "react-i18next";

import {
  resolveL10n,
  type ProviderTemplate,
} from "../../../../../../../shared/features/provider/built-in";
import { Badge } from "../../../../../components/ui/badge";
import { Button } from "../../../../../components/ui/button";
import { cn } from "../../../../../lib/utils";
import { badgeVariantMap } from "./helpers";

interface TemplatePickerProps {
  sortedTemplates: ProviderTemplate[];
  usedBuiltInIds: Set<string | undefined>;
  onSelectTemplate: (template: ProviderTemplate) => void;
  onSelectCustom: () => void;
  onCancel: () => void;
}

export function TemplatePicker({
  sortedTemplates,
  usedBuiltInIds,
  onSelectTemplate,
  onSelectCustom,
  onCancel,
}: TemplatePickerProps) {
  const { t, i18n } = useTranslation();
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t("settings.providers.chooseTemplate")}</p>
      <div className="grid grid-cols-3 gap-3">
        {sortedTemplates.map((template) => {
          const hostname = new URL(template.baseURL).hostname;
          const isUsed = usedBuiltInIds.has(template.id);
          const isDeprecated = template.badges?.includes("deprecated") ?? false;
          return (
            <button
              key={template.id}
              disabled={isUsed}
              className={cn(
                "flex flex-col items-start gap-1.5 rounded-xl border border-border/50 bg-background p-4 text-left transition-all",
                isUsed
                  ? "opacity-40 cursor-not-allowed"
                  : isDeprecated
                    ? "opacity-60 hover:border-border hover:shadow-sm cursor-pointer"
                    : "hover:border-border hover:shadow-sm cursor-pointer",
              )}
              onClick={() => !isUsed && onSelectTemplate(template)}
            >
              <span className="text-sm font-medium flex items-center gap-1.5 flex-wrap">
                {resolveL10n(template.name, i18n.language, template.nameLocalized)}
                {template.badges?.slice(0, 2).map((badge) => (
                  <Badge key={badge} variant={badgeVariantMap[badge]} size="sm">
                    {t(`settings.providers.badge.${badge}`)}
                  </Badge>
                ))}
              </span>
              <span className="text-xs text-muted-foreground line-clamp-2">
                {resolveL10n(template.description, i18n.language)}
              </span>
              <span className="text-[10px] text-muted-foreground/60 mt-auto">{hostname}</span>
            </button>
          );
        })}
        <button
          className="flex flex-col items-start gap-1.5 rounded-xl border border-dashed border-border/50 bg-background p-4 text-left hover:border-border hover:shadow-sm transition-all cursor-pointer"
          onClick={onSelectCustom}
        >
          <span className="text-sm font-medium">{t("settings.providers.custom")}</span>
          <span className="text-xs text-muted-foreground">
            {t("settings.providers.customDescription")}
          </span>
        </button>
      </div>
      <Button variant="outline" size="sm" onClick={onCancel}>
        {t("settings.providers.cancel")}
      </Button>
    </div>
  );
}
