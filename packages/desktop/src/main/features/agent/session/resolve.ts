/**
 * Provider + model resolution.
 *
 * `createSession` and `loadSession` both need to walk the same chain to
 * pick a provider (explicit param > settings > none) and a model
 * (explicit param > provider-aware setting > generic setting > SDK
 * default). The two methods used to inline this; pulled here so the
 * manager class can stay focused on orchestration.
 *
 * Behavior must remain bit-for-bit identical to the inlined versions —
 * these are pure refactors, not redesigns.
 */

import type { ModelScope } from "../../../../shared/features/agent/types";
import type { Provider } from "../../../../shared/features/provider/types";
import type { ConfigStore } from "../../config/config-store";
import type { ProjectStore } from "../../project/project-store";

import {
  readModelSetting,
  readProviderModelSetting,
  readProviderSetting,
} from "../claude-settings";

export interface ResolvedProviderAndModel {
  provider: Provider | undefined;
  modelSetting: { model: string; scope: ModelScope } | undefined;
}

/**
 * Resolve provider + model for `createSession`. Honors:
 *   - `explicitProviderId === null` → force SDK Default (skip settings)
 *   - `explicitProviderId` truthy   → look up that provider, fall through if disabled/missing
 *   - `explicitProviderId === undefined` → walk the settings chain
 *
 * Returns the resolved provider (or undefined) and a model setting
 * `{ model, scope }` suitable for handing to `initSession`.
 */
export async function resolveProviderAndModelForCreate(opts: {
  sessionId: string;
  cwd: string;
  model: string | undefined;
  explicitProviderId: string | null | undefined;
  configStore: ConfigStore;
  projectStore: ProjectStore;
  log: (fmt: string, ...args: unknown[]) => void;
}): Promise<ResolvedProviderAndModel> {
  const { sessionId, cwd, model, explicitProviderId, configStore, projectStore, log } = opts;

  // Resolve provider: explicit param overrides settings chain
  // null = force no provider (SDK Default), undefined = use settings chain
  let provider: Provider | undefined;
  if (explicitProviderId === null) {
    log("createSession: explicit null providerId — forcing SDK Default");
  } else if (explicitProviderId) {
    const p = configStore.getProvider(explicitProviderId);
    if (p?.enabled) {
      provider = p;
      log("createSession: using explicit provider=%s", p.name);
    } else {
      log(
        "createSession: explicit provider id=%s not found or disabled, falling through",
        explicitProviderId,
      );
    }
  }
  if (explicitProviderId === undefined && !provider) {
    const providerSetting = await readProviderSetting(sessionId, cwd, configStore, projectStore);
    provider = providerSetting?.provider;
  }

  if (provider && !explicitProviderId) {
    log("createSession: resolved provider=%s from settings", provider.name);
  }

  // Resolve model: explicit param > settings chain (provider-aware or SDK-default)
  // When explicitProviderId === null (force SDK Default), skip model settings
  // to avoid picking up a provider-specific model from the settings chain.
  let modelSetting: { model: string; scope: ModelScope } | undefined;
  if (model) {
    modelSetting = { model, scope: "session" };
  } else if (explicitProviderId === null) {
    // Let SDK use its own defaults
  } else if (provider) {
    modelSetting = await readProviderModelSetting(
      sessionId,
      cwd,
      provider,
      configStore,
      projectStore,
    );
  } else {
    modelSetting = await readModelSetting(sessionId, cwd);
  }

  return { provider, modelSetting };
}

/**
 * Resolve provider + model for `loadSession`. Always walks the full
 * settings chain (no explicit-id override path). Used when resuming a
 * persisted session — we don't ask the caller for a provider because
 * the session id is enough to scope settings lookups.
 */
export async function resolveProviderAndModelForLoad(opts: {
  sessionId: string;
  cwd: string;
  configStore: ConfigStore;
  projectStore: ProjectStore;
  log: (fmt: string, ...args: unknown[]) => void;
}): Promise<ResolvedProviderAndModel> {
  const { sessionId, cwd, configStore, projectStore, log } = opts;

  const providerSetting = await readProviderSetting(sessionId, cwd, configStore, projectStore);
  const provider = providerSetting?.provider;

  if (provider) {
    log("loadSession: resolved provider=%s scope=%s", provider.name, providerSetting!.scope);
  }

  const modelSetting = provider
    ? await readProviderModelSetting(sessionId, cwd, provider, configStore, projectStore)
    : await readModelSetting(sessionId, cwd);

  return { provider, modelSetting };
}
