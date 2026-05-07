/**
 * Provider editor form (the large editing UI block).
 *
 * Pure presentational component extracted from providers-panel.tsx. Receives
 * form state + all callbacks from the parent; emits user actions via callbacks.
 */
import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Info,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ProviderTemplate } from "../../../../../../../shared/features/provider/built-in";
import type {
  ModelTestResult,
  ProviderModelMap,
} from "../../../../../../../shared/features/provider/types";
import type { ProviderFormData } from "./helpers";

import { Badge } from "../../../../../components/ui/badge";
import { Button } from "../../../../../components/ui/button";
import { Input } from "../../../../../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../../components/ui/select";
import { Spinner } from "../../../../../components/ui/spinner";
import { Switch } from "../../../../../components/ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../../../../components/ui/tooltip";
import { BenchmarkButton } from "../../../../provider/benchmark-button";
import { BenchmarkMetrics } from "../../../../provider/benchmark-metrics";
import { BenchmarkTooltipContent } from "../../../../provider/benchmark-tooltip";

interface ProviderEditorFormProps {
  // Form state
  form: ProviderFormData;
  setForm: React.Dispatch<React.SetStateAction<ProviderFormData>>;
  isCreating: boolean;
  editingId: string | null;
  error: string | null;
  canCheck: boolean;
  activeBuiltIn: ProviderTemplate | undefined;

  // API key visibility
  showApiKey: boolean;
  setShowApiKey: React.Dispatch<React.SetStateAction<boolean>>;
  apiKeyCopied: boolean;
  onCopyApiKey: () => void;
  onApiKeyBlur: () => void;

  // Model add/remove
  newModelKey: string;
  setNewModelKey: (v: string) => void;
  newModelDisplay: string;
  setNewModelDisplay: (v: string) => void;
  onAddModel: () => void;
  onRemoveModel: (key: string) => void;

  // Model benchmark / test results
  modelTestResults: Record<string, ModelTestResult>;
  testingModels: Record<string, boolean>;

  // Sync (new template models)
  newModelEntries: [string, { displayName?: string }][];
  onSyncModels: () => void;
  onDismissSync: () => void;

  // ModelMap drift
  mapDriftEntries: [keyof ProviderModelMap, string][];
  dismissedMapSlots: Set<string>;
  onApplyMapDrift: (slot: keyof ProviderModelMap, value: string) => void;
  onDismissMapDrift: (slot: string) => void;

  // Env overrides
  newEnvKey: string;
  setNewEnvKey: (v: string) => void;
  newEnvValue: string;
  setNewEnvValue: (v: string) => void;
  onAddEnvOverride: () => void;
  onRemoveEnvOverride: (key: string) => void;

  // Actions
  onSave: () => void;
  onCancel: () => void;
  onResetDefaults: () => void;
}

export function ProviderEditorForm(props: ProviderEditorFormProps) {
  const { t } = useTranslation();
  const {
    form,
    setForm,
    isCreating,
    editingId,
    error,
    canCheck,
    activeBuiltIn,
    showApiKey,
    setShowApiKey,
    apiKeyCopied,
    onCopyApiKey,
    onApiKeyBlur,
    newModelKey,
    setNewModelKey,
    newModelDisplay,
    setNewModelDisplay,
    onAddModel,
    onRemoveModel,
    modelTestResults,
    testingModels,
    newModelEntries,
    onSyncModels,
    onDismissSync,
    mapDriftEntries,
    dismissedMapSlots,
    onApplyMapDrift,
    onDismissMapDrift,
    newEnvKey,
    setNewEnvKey,
    newEnvValue,
    setNewEnvValue,
    onAddEnvOverride,
    onRemoveEnvOverride,
    onSave,
    onCancel,
    onResetDefaults,
  } = props;

  const activeApiKeyURL = activeBuiltIn?.apiKeyURL;
  const activeDocURL = activeBuiltIn?.docURL;
  const modelKeys = Object.keys(form.models);

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* ID (read-only, only when editing) */}
      {editingId && (
        <div>
          <label className="text-sm font-medium">{t("settings.providers.id")}</label>
          <Input value={editingId} disabled className="mt-1" />
        </div>
      )}

      {/* Name */}
      <label className="block">
        <span className="text-sm font-medium">{t("settings.providers.name")}</span>
        <Input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="OpenRouter"
          className="mt-1"
        />
      </label>

      {/* Base URL */}
      <label className="block">
        <span className="text-sm font-medium">{t("settings.providers.baseURL")}</span>
        <Input
          value={form.baseURL}
          onChange={(e) => setForm((f) => ({ ...f, baseURL: e.target.value }))}
          placeholder="https://openrouter.ai/api"
          className="mt-1"
        />
      </label>

      {/* API Key */}
      <div>
        <label htmlFor="provider-apikey" className="text-sm font-medium">
          {t("settings.providers.apiKey")}
        </label>
        <div className="mt-1 flex items-center gap-1.5">
          <Input
            id="provider-apikey"
            type={showApiKey ? "text" : "password"}
            value={form.apiKey}
            onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
            onBlur={onApiKeyBlur}
            placeholder="sk-..."
            className="flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShowApiKey((v) => !v)}
            title={
              showApiKey ? t("settings.providers.hideApiKey") : t("settings.providers.showApiKey")
            }
          >
            {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={onCopyApiKey}
            disabled={!form.apiKey}
            title={t("settings.providers.copyApiKey")}
          >
            {apiKeyCopied ? (
              <Check className="h-4 w-4 text-success-foreground" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
        {(activeApiKeyURL || activeDocURL) && (
          <div className="flex items-center gap-3 mt-1.5">
            {activeApiKeyURL && (
              <a
                href={activeApiKeyURL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {t("settings.providers.getApiKey")}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {activeDocURL && (
              <a
                href={activeDocURL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {t("settings.providers.viewDocs")}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}
      </div>

      {/* Enabled */}
      {editingId && (
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">{t("settings.providers.enabled")}</label>
          <Switch
            checked={form.enabled}
            onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
          />
        </div>
      )}

      {/* Models */}
      <div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t("settings.providers.models")}</span>
          {canCheck && (
            <BenchmarkButton
              baseURL={form.baseURL}
              apiKey={form.apiKey}
              models={form.models}
              size="xs"
              variant="outline"
            />
          )}
        </div>
        {/* Sync new models section */}
        {editingId && newModelEntries.length > 0 && (
          <div className="mt-2 rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-primary flex items-center gap-1.5">
                {t("settings.providers.sync.newModels", { count: newModelEntries.length })}
              </span>
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="xs" onClick={onSyncModels}>
                  {t("settings.providers.sync.syncAll")}
                </Button>
                <Button variant="ghost" size="xs" onClick={onDismissSync}>
                  {t("settings.providers.sync.dismiss")}
                </Button>
              </div>
            </div>
            <div className="space-y-0.5">
              {newModelEntries.map(([id, entry]) => (
                <div key={id} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <code className="bg-muted px-1.5 py-0.5 rounded">{id}</code>
                  {entry.displayName && <span>{entry.displayName}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-1 space-y-1">
          {Object.entries(form.models).map(([key, entry]) => {
            const testKey = `${form.baseURL}:${key}`;
            const result = modelTestResults[testKey];
            const isRunning = testingModels[testKey] ?? false;
            const failed = result && !isRunning && !result.success;

            return (
              <div key={key}>
                <div className="flex items-center gap-2 text-sm">
                  <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{key}</code>
                  {entry.displayName && (
                    <span className="text-muted-foreground">{entry.displayName}</span>
                  )}
                  <div className="ml-auto flex items-center gap-1.5">
                    {isRunning && <Spinner className="h-3 w-3" />}
                    {result && !isRunning && result.success && result.type === "quick" && (
                      <Check className="h-3.5 w-3.5 text-success-foreground" />
                    )}
                    {result && !isRunning && result.success && result.type === "benchmark" && (
                      <Tooltip>
                        <TooltipTrigger className="cursor-default">
                          <BenchmarkMetrics
                            ttftMs={result.ttftMs}
                            tpot={result.tpot}
                            tps={result.tps}
                          />
                        </TooltipTrigger>
                        <TooltipPopup>
                          <BenchmarkTooltipContent result={result} />
                        </TooltipPopup>
                      </Tooltip>
                    )}
                    {failed && (
                      <Badge variant="error" size="sm">
                        <AlertCircle className="h-3 w-3" />
                        {t("settings.providers.benchmark.failed")}
                      </Badge>
                    )}
                    <button
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => onRemoveModel(key)}
                      aria-label={t("settings.providers.removeModel", { model: key })}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                {failed && result.error && (
                  <p className="text-xs text-destructive mt-0.5 ml-1 break-all">{result.error}</p>
                )}
              </div>
            );
          })}
          <div className="flex items-center gap-2 pt-1">
            <Input
              value={newModelKey}
              onChange={(e) => setNewModelKey(e.target.value)}
              placeholder={t("settings.providers.modelId")}
              className="flex-1 h-7 text-xs"
              onKeyDown={(e) => e.key === "Enter" && onAddModel()}
            />
            <Input
              value={newModelDisplay}
              onChange={(e) => setNewModelDisplay(e.target.value)}
              placeholder={t("settings.providers.displayName")}
              className="flex-1 h-7 text-xs"
              onKeyDown={(e) => e.key === "Enter" && onAddModel()}
            />
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onAddModel}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>

      {/* Model Map */}
      <div>
        <span className="text-sm font-medium">{t("settings.providers.modelMap")}</span>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {(["model", "haiku", "opus", "sonnet"] as const).map((slot) => (
            <div key={slot}>
              <label className="text-xs text-muted-foreground capitalize">{slot}</label>
              <Select
                value={form.modelMap[slot] ?? ""}
                onValueChange={(val) =>
                  setForm((f) => ({
                    ...f,
                    modelMap: {
                      ...f.modelMap,
                      [slot]: val || undefined,
                    },
                  }))
                }
              >
                <SelectTrigger size="sm" className="w-full mt-1">
                  <SelectValue>{form.modelMap[slot] ?? "--"}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="">--</SelectItem>
                  {modelKeys.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          ))}
        </div>
        {/* ModelMap drift hints */}
        {editingId &&
          mapDriftEntries
            .filter(([slot]) => !dismissedMapSlots.has(slot))
            .map(([slot, recommended]) => (
              <div
                key={slot}
                className="mt-2 flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md px-2.5 py-1.5"
              >
                <Info className="h-3 w-3 shrink-0" />
                <span className="flex-1">
                  {t(
                    form.modelMap[slot]
                      ? "settings.providers.sync.modelMapDrift"
                      : "settings.providers.sync.modelMapDriftEmpty",
                    {
                      slot,
                      recommended,
                      current: form.modelMap[slot] ?? "",
                    },
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => onApplyMapDrift(slot, recommended)}
                >
                  {t("settings.providers.sync.apply")}
                </Button>
                <Button variant="ghost" size="xs" onClick={() => onDismissMapDrift(slot)}>
                  {t("settings.providers.sync.dismiss")}
                </Button>
              </div>
            ))}
      </div>

      {/* Env Overrides */}
      <div>
        <span className="text-sm font-medium">{t("settings.providers.envOverrides")}</span>
        <div className="mt-1 space-y-1">
          {Object.entries(form.envOverrides).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2 text-sm">
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{key}</code>
              <span className="text-muted-foreground text-xs truncate">{value || "(delete)"}</span>
              <button
                className="ml-auto text-muted-foreground hover:text-destructive"
                onClick={() => onRemoveEnvOverride(key)}
                aria-label={t("settings.providers.removeEnvOverride", { key })}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <Input
              value={newEnvKey}
              onChange={(e) => setNewEnvKey(e.target.value)}
              placeholder="ENV_VAR"
              className="flex-1 h-7 text-xs"
              onKeyDown={(e) => e.key === "Enter" && onAddEnvOverride()}
            />
            <Input
              value={newEnvValue}
              onChange={(e) => setNewEnvValue(e.target.value)}
              placeholder="value"
              className="flex-1 h-7 text-xs"
              onKeyDown={(e) => e.key === "Enter" && onAddEnvOverride()}
            />
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onAddEnvOverride}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <Button size="sm" onClick={onSave} data-track-id="provider.form.saved">
          {isCreating ? t("settings.providers.create") : t("settings.providers.save")}
        </Button>
        <Button variant="outline" size="sm" onClick={onCancel}>
          {t("settings.providers.cancel")}
        </Button>
        {editingId && form.builtInId && (
          <Button variant="ghost" size="sm" onClick={onResetDefaults} className="ml-auto">
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            {t("settings.providers.resetDefaults")}
          </Button>
        )}
      </div>
    </div>
  );
}
