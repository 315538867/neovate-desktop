/**
 * Pure helpers, types, and constants for the Providers settings panel.
 *
 * Extracted from providers-panel.tsx to keep the orchestrating component focused
 * on state management and JSX dispatch.
 */
import type {
  Provider,
  ProviderModelMap,
} from "../../../../../../../shared/features/provider/types";

import {
  resolveL10n,
  type ProviderBadgeType,
  type ProviderTemplate,
} from "../../../../../../../shared/features/provider/built-in";

export type ProviderFormData = {
  name: string;
  baseURL: string;
  apiKey: string;
  models: Record<string, { displayName?: string }>;
  modelMap: ProviderModelMap;
  envOverrides: Record<string, string>;
  enabled: boolean;
  builtInId?: string;
  dismissedSyncModels?: string[];
};

export const emptyForm: ProviderFormData = {
  name: "",
  baseURL: "",
  apiKey: "",
  models: {},
  modelMap: {},
  envOverrides: {},
  enabled: true,
};

export const badgeVariantMap: Record<
  ProviderBadgeType,
  "success" | "info" | "default" | "warning"
> = {
  recommended: "success",
  internal: "info",
  new: "default",
  deprecated: "warning",
};

const badgeSortPriority: Record<ProviderBadgeType, number> = {
  internal: 1,
  recommended: 2,
  new: 3,
  deprecated: 5,
};

const NO_BADGE_PRIORITY = 4;

export function getTemplateSortPriority(t: ProviderTemplate): number {
  if (!t.badges || t.badges.length === 0) return NO_BADGE_PRIORITY;
  return Math.min(...t.badges.map((b) => badgeSortPriority[b]));
}

export function providerToForm(p: Provider): ProviderFormData {
  return {
    name: p.name,
    baseURL: p.baseURL,
    apiKey: p.apiKey,
    models: { ...p.models },
    modelMap: { ...p.modelMap },
    envOverrides: { ...p.envOverrides },
    enabled: p.enabled,
    builtInId: p.builtInId,
    dismissedSyncModels: p.dismissedSyncModels ? [...p.dismissedSyncModels] : undefined,
  };
}

export function builtInToForm(t: ProviderTemplate, lang: string): ProviderFormData {
  return {
    name: resolveL10n(t.name, lang, t.nameLocalized),
    baseURL: t.baseURL,
    apiKey: "",
    models: { ...t.models },
    modelMap: { ...t.modelMap },
    envOverrides: { ...t.envOverrides },
    enabled: true,
    builtInId: t.id,
  };
}
