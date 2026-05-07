import { cp } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type {
  MarketplaceSource,
  PluginComponents,
} from "../../../shared/features/claude-code-plugins/types";

import { gitClone, gitCloneSubdir } from "./git-utils";
import { readJsonSafe } from "./plugins-io";

// -- Path constants --

export const CLAUDE_DIR = path.join(homedir(), ".claude");
export const PLUGINS_DIR = path.join(CLAUDE_DIR, "plugins");
export const INSTALLED_PLUGINS_FILE = path.join(PLUGINS_DIR, "installed_plugins.json");
export const KNOWN_MARKETPLACES_FILE = path.join(PLUGINS_DIR, "known_marketplaces.json");
export const SETTINGS_FILE = path.join(CLAUDE_DIR, "settings.json");
export const MARKETPLACES_DIR = path.join(PLUGINS_DIR, "marketplaces");
export const CACHE_DIR = path.join(PLUGINS_DIR, "cache");

// -- Source resolution --

export interface PluginSourceObject {
  source: string;
  repo?: string;
  url?: string;
  path?: string;
  ref?: string;
  sha?: string;
}

export async function resolvePluginSource(
  source: string | PluginSourceObject,
  marketplaceDir: string,
  destDir: string,
): Promise<void> {
  if (typeof source === "string") {
    const resolved = path.resolve(marketplaceDir, source);
    await cp(resolved, destDir, { recursive: true });
    return;
  }
  switch (source.source) {
    case "github":
      await gitClone(`https://github.com/${source.repo}.git`, destDir);
      break;
    case "url":
      await gitClone(source.url!, destDir);
      break;
    case "git-subdir":
      await gitCloneSubdir(source.url!, source.path!, source.ref, destDir);
      break;
    case "local":
      await cp(source.path!, destDir, { recursive: true });
      break;
    default:
      throw new Error(`Unknown plugin source type: ${source.source}`);
  }
}

// -- Plugin manifest helpers --

export interface PluginManifest {
  name?: string;
  description?: string;
  version?: string;
  author?: { name: string; email?: string; url?: string };
  homepage?: string;
  license?: string;
  keywords?: string[];
  commands?: unknown;
  commandsPaths?: unknown;
  skills?: unknown;
  skillsPaths?: unknown;
  agents?: unknown;
  agentsPaths?: unknown;
  hooks?: unknown;
  hooksPath?: unknown;
  mcpServers?: unknown;
  lspServers?: unknown;
}

export function detectComponents(manifest: PluginManifest): PluginComponents {
  return {
    hasCommands: !!(manifest.commands || manifest.commandsPaths),
    hasSkills: !!(manifest.skills || manifest.skillsPaths),
    hasAgents: !!(manifest.agents || manifest.agentsPaths),
    hasHooks: !!(manifest.hooks || manifest.hooksPath),
    hasMcpServers: !!manifest.mcpServers,
    hasLspServers: !!manifest.lspServers,
  };
}

export async function readPluginManifest(installPath: string): Promise<PluginManifest> {
  const manifestPath = path.join(installPath, ".claude-plugin", "plugin.json");
  return readJsonSafe<PluginManifest>(manifestPath, {});
}

// -- Marketplace manifest --

export interface MarketplaceManifest {
  name?: string;
  description?: string;
  plugins?: Array<{
    name: string;
    description?: string;
    author?: { name: string; email?: string; url?: string };
    category?: string;
    homepage?: string;
    version?: string;
    keywords?: string[];
    source: string | PluginSourceObject;
  }>;
}

// -- Installed plugins file format (v2) --

export interface InstalledPluginsFile {
  version: number;
  plugins: Record<
    string,
    Array<{
      scope: string;
      projectPath?: string;
      installPath: string;
      version: string;
      installedAt: string;
      lastUpdated: string;
      gitCommitSha?: string;
    }>
  >;
}

export const EMPTY_INSTALLED: InstalledPluginsFile = { version: 2, plugins: {} };

// -- Settings file --

export interface SettingsFile {
  enabledPlugins?: Record<string, boolean>;
  [key: string]: unknown;
}

// -- Marketplace input parsing --

export type KnownMarketplaceEntry = {
  source: MarketplaceSource;
  installLocation: string;
  lastUpdated?: string;
  autoUpdate?: boolean;
};

export function parseMarketplaceInput(input: string): {
  name: string;
  cloneUrl: string;
  source: MarketplaceSource;
} {
  const trimmed = input.trim();

  // GitHub shorthand: "owner/repo"
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    return {
      name: trimmed.split("/")[1]!,
      cloneUrl: `https://github.com/${trimmed}.git`,
      source: { source: "github", repo: trimmed },
    };
  }

  // Git URL
  if (trimmed.startsWith("https://") || trimmed.startsWith("git@")) {
    const name =
      trimmed
        .split("/")
        .pop()
        ?.replace(/\.git$/, "") ?? "unknown";
    return {
      name,
      cloneUrl: trimmed,
      source: { source: "git", url: trimmed },
    };
  }

  throw new Error(`Invalid marketplace source: ${trimmed}. Use "owner/repo" or a git URL.`);
}

export function parsePluginId(pluginId: string): [name: string, marketplace: string] {
  const at = pluginId.lastIndexOf("@");
  if (at === -1) return [pluginId, "unknown"];
  return [pluginId.slice(0, at), pluginId.slice(at + 1)];
}
