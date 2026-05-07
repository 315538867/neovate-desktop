import debug from "debug";
import { Edit2, Plus, RefreshCw, Server, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ProviderTemplate } from "../../../../../../shared/features/provider/built-in";
import type { Provider, ProviderModelMap } from "../../../../../../shared/features/provider/types";

import {
  getModelMapDrift,
  getNewTemplateModels,
} from "../../../../../../shared/features/provider/sync";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../../../../components/ui/alert-dialog";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Switch } from "../../../../components/ui/switch";
import { useRendererApp } from "../../../../core/app";
import { useProviderStore } from "../../../provider/store";
import { SettingsRow } from "../settings-row";
import { ProviderEditorForm } from "./providers-panel/editor-form";
import {
  builtInToForm,
  emptyForm,
  getTemplateSortPriority,
  providerToForm,
  type ProviderFormData,
} from "./providers-panel/helpers";
import { TemplatePicker } from "./providers-panel/template-picker";

const log = debug("neovate:settings:providers");

export const ProvidersPanel = () => {
  const { t, i18n } = useTranslation();
  const providerTemplates = useRendererApp().pluginManager.contributions.providerTemplates.map(
    (c) => c.value,
  );
  const providers = useProviderStore((s) => s.providers);
  const loaded = useProviderStore((s) => s.loaded);
  const load = useProviderStore((s) => s.load);
  const addProvider = useProviderStore((s) => s.addProvider);
  const updateProvider = useProviderStore((s) => s.updateProvider);
  const removeProvider = useProviderStore((s) => s.removeProvider);
  const modelTestResults = useProviderStore((s) => s.modelTestResults);
  const testingModels = useProviderStore((s) => s.testingModels);
  const cancelTests = useProviderStore((s) => s.cancelTests);
  const clearTestResults = useProviderStore((s) => s.clearTestResults);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [form, setForm] = useState<ProviderFormData>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  // API key visibility state
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);

  // Model list editing state
  const [newModelKey, setNewModelKey] = useState("");
  const [newModelDisplay, setNewModelDisplay] = useState("");

  // Env overrides editing state
  const [newEnvKey, setNewEnvKey] = useState("");
  const [newEnvValue, setNewEnvValue] = useState("");

  // Delete confirmation state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [providerToDelete, setProviderToDelete] = useState<string | null>(null);

  // Reset confirmation state
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  // ModelMap drift dismiss state (component-local, not persisted)
  const [dismissedMapSlots, setDismissedMapSlots] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  // Cancel in-flight benchmarks when leaving the providers panel
  useEffect(() => {
    return () => cancelTests();
  }, [cancelTests]);

  const usedBuiltInIds = useMemo(
    () => new Set(providers.map((p) => p.builtInId).filter(Boolean)),
    [providers],
  );

  const sortedTemplates = useMemo(
    () =>
      [...providerTemplates].sort(
        (a, b) => getTemplateSortPriority(a) - getTemplateSortPriority(b),
      ),
    [providerTemplates],
  );

  const canCheck = useMemo(() => {
    try {
      new URL(form.baseURL);
      return form.apiKey.trim() !== "" && Object.keys(form.models).length > 0;
    } catch {
      return false;
    }
  }, [form.baseURL, form.apiKey, form.models]);

  const startCreate = useCallback(() => {
    setEditingId(null);
    setError(null);
    setShowApiKey(false);
    setShowTemplatePicker(true);
    setIsCreating(false);
    useProviderStore.setState((state) => {
      state.modelTestResults = {};
    });
  }, []);

  const selectTemplate = useCallback(
    (template: ProviderTemplate) => {
      setShowTemplatePicker(false);
      setIsCreating(true);
      setShowApiKey(false);
      setForm(builtInToForm(template, i18n.language));
    },
    [i18n.language],
  );

  const selectCustom = useCallback(() => {
    setShowTemplatePicker(false);
    setIsCreating(true);
    setShowApiKey(false);
    setForm(emptyForm);
  }, []);

  const startEdit = useCallback(
    (p: Provider) => {
      clearTestResults(p.baseURL);
      setEditingId(p.id);
      setIsCreating(false);
      setShowApiKey(false);
      setForm(providerToForm(p));
      setError(null);
      setDismissedMapSlots(new Set());
    },
    [clearTestResults],
  );

  const cancel = useCallback(() => {
    setEditingId(null);
    setIsCreating(false);
    setShowTemplatePicker(false);
    setShowApiKey(false);
    setError(null);
  }, []);

  const handleCopyApiKey = useCallback(() => {
    if (!form.apiKey) return;
    navigator.clipboard.writeText(form.apiKey);
    setApiKeyCopied(true);
    setTimeout(() => setApiKeyCopied(false), 2000);
  }, [form.apiKey]);

  const handleApiKeyBlur = useCallback(() => {
    setShowApiKey(false);
  }, []);

  const validate = (): string | null => {
    if (!form.name.trim()) return t("settings.providers.validation.nameRequired");
    try {
      new URL(form.baseURL);
    } catch {
      return t("settings.providers.validation.invalidURL");
    }
    if (!form.apiKey.trim()) return t("settings.providers.validation.apiKeyRequired");
    if (Object.keys(form.models).length === 0)
      return t("settings.providers.validation.modelRequired");
    for (const [slot, modelId] of Object.entries(form.modelMap)) {
      if (modelId && !(modelId in form.models)) {
        return t("settings.providers.validation.modelMapInvalid", { slot, modelId });
      }
    }
    return null;
  };

  const handleSave = useCallback(async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    log("saving provider: name=%s isCreating=%s editingId=%s", form.name, isCreating, editingId);
    try {
      if (isCreating) {
        await addProvider({
          name: form.name.trim(),
          baseURL: form.baseURL.trim(),
          apiKey: form.apiKey.trim(),
          models: form.models,
          modelMap: form.modelMap,
          envOverrides: Object.keys(form.envOverrides).length > 0 ? form.envOverrides : undefined,
          builtInId: form.builtInId,
          dismissedSyncModels: form.dismissedSyncModels,
        });
      } else if (editingId) {
        await updateProvider(editingId, {
          name: form.name.trim(),
          baseURL: form.baseURL.trim(),
          apiKey: form.apiKey.trim(),
          models: form.models,
          modelMap: form.modelMap,
          envOverrides: form.envOverrides,
          enabled: form.enabled,
          dismissedSyncModels: form.dismissedSyncModels,
        });
      }
      cancel();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settings.providers.saveFailed"));
    }
  }, [form, isCreating, editingId, addProvider, updateProvider, cancel]);

  const handleDeleteClick = useCallback((id: string) => {
    setProviderToDelete(id);
    setDeleteConfirmOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!providerToDelete) return;
    log("deleting provider: id=%s", providerToDelete);
    try {
      await removeProvider(providerToDelete);
      if (editingId === providerToDelete) cancel();
      setDeleteConfirmOpen(false);
      setProviderToDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settings.providers.deleteFailed"));
    }
  }, [editingId, providerToDelete, removeProvider, cancel]);

  const handleToggle = useCallback(
    async (p: Provider) => {
      log("toggling provider: id=%s enabled=%s", p.id, !p.enabled);
      try {
        await updateProvider(p.id, { enabled: !p.enabled });
      } catch (e) {
        setError(e instanceof Error ? e.message : t("settings.providers.toggleFailed"));
      }
    },
    [updateProvider],
  );

  const addModel = useCallback(() => {
    if (!newModelKey.trim()) return;
    setForm((f) => ({
      ...f,
      models: {
        ...f.models,
        [newModelKey.trim()]: newModelDisplay.trim() ? { displayName: newModelDisplay.trim() } : {},
      },
    }));
    setNewModelKey("");
    setNewModelDisplay("");
  }, [newModelKey, newModelDisplay]);

  const removeModel = useCallback(
    (key: string) => {
      setForm((f) => {
        const models = { ...f.models };
        delete models[key];
        // Clean up modelMap references
        const modelMap = { ...f.modelMap };
        for (const [slot, val] of Object.entries(modelMap)) {
          if (val === key) delete modelMap[slot as keyof ProviderModelMap];
        }
        // Auto-dismiss if this model is from the template
        const template = f.builtInId
          ? providerTemplates.find((tpl) => tpl.id === f.builtInId)
          : undefined;
        let dismissedSyncModels = f.dismissedSyncModels;
        if (template && key in template.models) {
          dismissedSyncModels = [...(dismissedSyncModels ?? []), key];
        }
        return { ...f, models, modelMap, dismissedSyncModels };
      });
    },
    [providerTemplates],
  );

  const addEnvOverride = useCallback(() => {
    if (!newEnvKey.trim()) return;
    setForm((f) => ({
      ...f,
      envOverrides: { ...f.envOverrides, [newEnvKey.trim()]: newEnvValue },
    }));
    setNewEnvKey("");
    setNewEnvValue("");
  }, [newEnvKey, newEnvValue]);

  const removeEnvOverride = useCallback((key: string) => {
    setForm((f) => {
      const envOverrides = { ...f.envOverrides };
      delete envOverrides[key];
      return { ...f, envOverrides };
    });
  }, []);

  const handleResetDefaults = useCallback(() => {
    if (!form.builtInId) return;
    setResetConfirmOpen(true);
  }, [form.builtInId]);

  const handleConfirmReset = useCallback(() => {
    if (!form.builtInId) return;
    const template = providerTemplates.find((tpl) => tpl.id === form.builtInId);
    if (!template) return;
    setForm((f) => ({
      ...f,
      baseURL: template.baseURL,
      models: { ...template.models },
      modelMap: { ...template.modelMap },
      envOverrides: { ...template.envOverrides },
      dismissedSyncModels: undefined,
    }));
    setResetConfirmOpen(false);
  }, [form.builtInId, providerTemplates]);

  // Compute new template models available for each provider (for list badge)
  const providerSyncInfo = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of providers) {
      if (!p.builtInId) continue;
      const template = providerTemplates.find((tpl) => tpl.id === p.builtInId);
      if (!template) continue;
      const newModels = getNewTemplateModels(p, template);
      const count = Object.keys(newModels).length;
      if (count > 0) map.set(p.id, count);
    }
    return map;
  }, [providers, providerTemplates]);

  const activeBuiltIn = useMemo(
    () => (form.builtInId ? providerTemplates.find((tpl) => tpl.id === form.builtInId) : undefined),
    [form.builtInId, providerTemplates],
  );

  // Compute new models and modelMap drift for the current form state
  const formAsProvider = useMemo(
    (): Provider => ({
      id: editingId ?? "",
      name: form.name,
      enabled: form.enabled,
      baseURL: form.baseURL,
      apiKey: form.apiKey,
      models: form.models,
      modelMap: form.modelMap,
      envOverrides: form.envOverrides,
      builtInId: form.builtInId,
      dismissedSyncModels: form.dismissedSyncModels,
    }),
    [form, editingId],
  );

  const formNewModels = useMemo(() => {
    if (!activeBuiltIn) return {};
    return getNewTemplateModels(formAsProvider, activeBuiltIn);
  }, [formAsProvider, activeBuiltIn]);

  const formMapDrift = useMemo(() => {
    if (!activeBuiltIn) return {};
    return getModelMapDrift(formAsProvider, activeBuiltIn);
  }, [formAsProvider, activeBuiltIn]);

  const newModelEntries = Object.entries(formNewModels);
  const mapDriftEntries = Object.entries(formMapDrift) as [keyof ProviderModelMap, string][];

  const handleSyncModels = useCallback(() => {
    setForm((f) => {
      const models = { ...f.models, ...formNewModels };
      const modelMap = { ...f.modelMap };
      // Fill empty modelMap slots from template
      if (activeBuiltIn) {
        for (const slot of ["model", "haiku", "opus", "sonnet"] as const) {
          const templateVal = activeBuiltIn.modelMap[slot];
          if (templateVal && !modelMap[slot] && templateVal in models) {
            modelMap[slot] = templateVal;
          }
        }
      }
      return { ...f, models, modelMap };
    });
    // Clear test results for new models
    if (form.baseURL) clearTestResults(form.baseURL);
  }, [formNewModels, activeBuiltIn, form.baseURL, clearTestResults]);

  const handleDismissSync = useCallback(() => {
    const newDismissed = Object.keys(formNewModels);
    setForm((f) => ({
      ...f,
      dismissedSyncModels: [...(f.dismissedSyncModels ?? []), ...newDismissed],
    }));
  }, [formNewModels]);

  const handleApplyMapDrift = useCallback((slot: keyof ProviderModelMap, value: string) => {
    setForm((f) => ({
      ...f,
      modelMap: { ...f.modelMap, [slot]: value },
    }));
    setDismissedMapSlots((s) => new Set(s).add(slot));
  }, []);

  const handleDismissMapDrift = useCallback((slot: string) => {
    setDismissedMapSlots((s) => new Set(s).add(slot));
  }, []);

  const isEditing = isCreating || editingId !== null;

  return (
    <div>
      <h1 className="text-xl font-semibold mb-8 flex items-center gap-3 text-foreground">
        <span className="flex items-center justify-center size-9 rounded-xl bg-primary/10">
          <Server className="size-5 text-primary" />
        </span>
        {t("settings.providers")}
      </h1>

      {showTemplatePicker && (
        <TemplatePicker
          sortedTemplates={sortedTemplates}
          usedBuiltInIds={usedBuiltInIds}
          onSelectTemplate={selectTemplate}
          onSelectCustom={selectCustom}
          onCancel={cancel}
        />
      )}

      {!isEditing && !showTemplatePicker && (
        <div className="space-y-0 rounded-xl bg-muted/30 border border-border/50 px-5 py-2">
          {providers.map((p) => (
            <SettingsRow
              key={p.id}
              title={
                <span className="flex items-center gap-2">
                  {p.name}
                  {providerSyncInfo.has(p.id) && (
                    <Badge variant="default" size="sm">
                      <RefreshCw className="h-3 w-3 mr-0.5" />
                      {t("settings.providers.sync.newModels", {
                        count: providerSyncInfo.get(p.id),
                      })}
                    </Badge>
                  )}
                </span>
              }
              description={p.baseURL}
            >
              <div className="flex items-center gap-2">
                <Switch checked={p.enabled} onCheckedChange={() => handleToggle(p)} />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => startEdit(p)}
                  data-track-id="provider.form.opened"
                >
                  <Edit2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive"
                  onClick={() => handleDeleteClick(p.id)}
                  data-track-id="provider.delete.initiated"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </SettingsRow>
          ))}
          {providers.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {t("settings.providers.empty")}
            </p>
          )}
        </div>
      )}

      {!isEditing && !showTemplatePicker && (
        <div className="mt-5 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={startCreate}
            data-track-id="provider.add.initiated"
          >
            <Plus className="h-4 w-4 mr-1" />
            {t("settings.providers.add")}
          </Button>
        </div>
      )}

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.providers.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.providers.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t("settings.providers.cancel")}
            </AlertDialogClose>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              data-track-id="provider.delete.confirmed"
            >
              {t("common.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.providers.resetDefaults")}</AlertDialogTitle>
            <AlertDialogDescription>{t("settings.providers.resetConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t("settings.providers.cancel")}
            </AlertDialogClose>
            <Button
              variant="destructive"
              onClick={handleConfirmReset}
              data-track-id="provider.reset.confirmed"
            >
              {t("settings.providers.resetDefaults")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      {isEditing && (
        <ProviderEditorForm
          form={form}
          setForm={setForm}
          isCreating={isCreating}
          editingId={editingId}
          error={error}
          canCheck={canCheck}
          activeBuiltIn={activeBuiltIn}
          showApiKey={showApiKey}
          setShowApiKey={setShowApiKey}
          apiKeyCopied={apiKeyCopied}
          onCopyApiKey={handleCopyApiKey}
          onApiKeyBlur={handleApiKeyBlur}
          newModelKey={newModelKey}
          setNewModelKey={setNewModelKey}
          newModelDisplay={newModelDisplay}
          setNewModelDisplay={setNewModelDisplay}
          onAddModel={addModel}
          onRemoveModel={removeModel}
          modelTestResults={modelTestResults}
          testingModels={testingModels}
          newModelEntries={newModelEntries}
          onSyncModels={handleSyncModels}
          onDismissSync={handleDismissSync}
          mapDriftEntries={mapDriftEntries}
          dismissedMapSlots={dismissedMapSlots}
          onApplyMapDrift={handleApplyMapDrift}
          onDismissMapDrift={handleDismissMapDrift}
          newEnvKey={newEnvKey}
          setNewEnvKey={setNewEnvKey}
          newEnvValue={newEnvValue}
          setNewEnvValue={setNewEnvValue}
          onAddEnvOverride={addEnvOverride}
          onRemoveEnvOverride={removeEnvOverride}
          onSave={handleSave}
          onCancel={cancel}
          onResetDefaults={handleResetDefaults}
        />
      )}
    </div>
  );
};
