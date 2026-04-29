import type Store from "electron-store";

import type { PipelineTemplate } from "../../../../shared/features/agent-orchestrator/schemas";
import type { StorageService } from "../../../core/storage-service";

import { validateDAG } from "../dag/dag-validator";
import { getBuiltinTemplates, registerTemplate } from "./registry";

/**
 * 启动时加载所有模板并校验 DAG。
 * 1. 加载内置模板
 * 2. 加载用户自定义模板
 * 3. 校验所有模板 DAG
 */
export function loadTemplates(storage: StorageService): PipelineTemplate[] {
  // 1. 内置模板（已在 registry 注册）
  const builtins = getBuiltinTemplates();

  // 2. 用户自定义模板
  const customStore: Store = storage.scoped("orchestrator/custom-templates");
  const customTemplates = (customStore.get("templates") ?? []) as PipelineTemplate[];
  for (const tpl of customTemplates) {
    try {
      registerTemplate(tpl);
    } catch {
      // 重复注册忽略
    }
  }

  // 3. 校验
  const allTemplates = [...builtins, ...customTemplates];
  const errors: string[] = [];
  for (const tpl of allTemplates) {
    const result = validateDAG(tpl);
    if (!result.ok) {
      errors.push(`${tpl.id}: ${result.errors.join(", ")}`);
    }
  }

  if (errors.length > 0) {
    console.warn("[Orchestrator] Template DAG validation errors:", errors);
  }

  return allTemplates;
}

/**
 * 保存用户自定义模板
 */
export function saveCustomTemplates(storage: StorageService, templates: PipelineTemplate[]): void {
  const customStore: Store = storage.scoped("orchestrator/custom-templates");
  customStore.set("templates", templates);
}
