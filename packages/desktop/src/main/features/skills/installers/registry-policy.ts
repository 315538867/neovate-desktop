/**
 * NPM registry whitelist (Wave 4.3 commit 7.4).
 *
 * Why this exists:
 *   The skills installer accepts a source ref like `npm:my-skill?registry=...`
 *   and the user-level config has a default `npmRegistry`. Without a
 *   whitelist, a malicious link or a subverted config can point the
 *   installer at an arbitrary host that serves attacker-controlled
 *   tarballs — a supply-chain RCE vector.
 *
 * Properties enforced:
 *   - protocol must be `https:` (no `http:`, no `file:`, no `data:`)
 *   - host must match an entry in the whitelist (case-insensitive,
 *     trailing slash insensitive)
 *   - the empty string is treated as "use npm's built-in default"
 *     and is allowed (npm itself enforces protocol there)
 *
 * The whitelist is intentionally short. If a user needs another
 * registry they can extend it via env (`NEOVATE_NPM_REGISTRY_ALLOW`,
 * comma-separated) — that escape hatch is gated by the env var being
 * set, which a drive-by deeplink can't do.
 */

const BUILT_IN: readonly string[] = [
  "https://registry.npmjs.org/",
  "https://registry.npmmirror.com/",
];

function readEnvAdditions(): string[] {
  const raw = process.env.NEOVATE_NPM_REGISTRY_ALLOW;
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Effective whitelist (built-ins + env additions). */
export function getRegistryWhitelist(): readonly string[] {
  return [...BUILT_IN, ...readEnvAdditions()];
}

export const DEFAULT_REGISTRY_WHITELIST = BUILT_IN;

/** Normalize for comparison: lowercase, ensure trailing slash on origin form. */
function normalize(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, "/");
}

/**
 * Returns true iff `registryUrl` is empty (meaning "use npm default") or
 * matches an entry in the active whitelist on protocol + host.
 */
export function isAllowedRegistry(registryUrl: string): boolean {
  if (registryUrl === "") return true;
  let parsed: URL;
  try {
    parsed = new URL(registryUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const candidate = normalize(`${parsed.protocol}//${parsed.host}/`);
  return getRegistryWhitelist().some((allowed) => normalize(allowed) === candidate);
}

/** Throws if the registry is not allowed; safe to call with the empty string. */
export function assertRegistryAllowed(registryUrl: string): void {
  if (!isAllowedRegistry(registryUrl)) {
    throw new Error(
      `npm registry not allowed: ${registryUrl}. ` +
        `Allowed: ${getRegistryWhitelist().join(", ")} ` +
        `(extend via NEOVATE_NPM_REGISTRY_ALLOW env).`,
    );
  }
}
