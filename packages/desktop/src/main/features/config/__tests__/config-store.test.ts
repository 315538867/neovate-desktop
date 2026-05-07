/**
 * Hard-fail behaviour for `safeStorage` (Wave 4.3 commit 7.2).
 *
 * The contract: when `safeStorage.isEncryptionAvailable()` is false, ALL three
 * code paths that would handle a credential — `encryptApiKey` (called from
 * `addProvider` / `updateProvider`), `decryptApiKey` (called from `getProviders`
 * / `getProvider`), and `migrateApiKeys` — must throw `KeychainUnavailableError`
 * rather than silently degrade. Silent degradation is what we're moving away
 * from: it left plaintext API keys in the store and surfaced as confusing
 * "missing API key" failures later.
 *
 * `decryptApiKey` distinguishes "keychain unavailable" from "ciphertext is
 * corrupted" — the latter still degrades per-row to `apiKey: ""` so a single
 * bad row can't take out the whole provider list. We assert both paths.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSafeStorage } = vi.hoisted(() => ({
  mockSafeStorage: {
    isEncryptionAvailable: vi.fn<() => boolean>(),
    encryptString: vi.fn<(plaintext: string) => Buffer>(),
    decryptString: vi.fn<(buf: Buffer) => string>(),
  },
}));

vi.mock("electron", () => ({
  safeStorage: mockSafeStorage,
}));

// Re-route the store cwd to a per-test tmp dir so we don't pollute the user's
// real `~/.neovate-desktop`. APP_DATA_DIR is read once at module import — we
// override it before importing config-store via vi.mock + a hoisted handle.
const { tmpHandle } = vi.hoisted(() => ({
  tmpHandle: { dir: "" as string },
}));

vi.mock("../../../core/app-paths", () => ({
  get APP_DATA_DIR() {
    return tmpHandle.dir;
  },
}));

import { ConfigStore, KeychainUnavailableError } from "../config-store";

describe("ConfigStore safeStorage hard-fail (Wave 4.3 commit 7.2)", () => {
  let store: ConfigStore;

  beforeEach(() => {
    tmpHandle.dir = mkdtempSync(join(tmpdir(), "neovate-config-test-"));
    mockSafeStorage.isEncryptionAvailable.mockReset();
    mockSafeStorage.encryptString.mockReset();
    mockSafeStorage.decryptString.mockReset();
    // Default to "keychain works" so each test opts into the failure mode it's exercising.
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
    mockSafeStorage.encryptString.mockImplementation((s) => Buffer.from(`enc:${s}`));
    mockSafeStorage.decryptString.mockImplementation((b) =>
      b.toString("utf-8").replace(/^enc:/, ""),
    );
    store = new ConfigStore();
  });

  afterEach(() => {
    rmSync(tmpHandle.dir, { recursive: true, force: true });
  });

  describe("addProvider (encryptApiKey path)", () => {
    it("throws KeychainUnavailableError when keychain becomes unavailable", () => {
      mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);

      expect(() =>
        store.addProvider({
          id: "test",
          name: "Test",
          enabled: true,
          baseURL: "https://api.example.com",
          apiKey: "sk-secret",
          models: {},
          modelMap: {},
          envOverrides: {},
        }),
      ).toThrow(KeychainUnavailableError);
    });

    it("does NOT throw when the provider has no apiKey to encrypt", () => {
      mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);

      // No apiKey means no secret to protect — pass through is the safe behaviour.
      expect(() =>
        store.addProvider({
          id: "test",
          name: "Test",
          enabled: true,
          baseURL: "https://api.example.com",
          apiKey: "",
          models: {},
          modelMap: {},
          envOverrides: {},
        }),
      ).not.toThrow();
    });
  });

  describe("getProviders (decryptApiKey path)", () => {
    it("throws KeychainUnavailableError when reading an encrypted provider", () => {
      // Seed an encrypted provider while keychain works.
      store.addProvider({
        id: "p1",
        name: "P1",
        enabled: true,
        baseURL: "https://api.example.com",
        apiKey: "sk-secret",
        models: {},
        modelMap: {},
        envOverrides: {},
      });

      // Now simulate keychain becoming unavailable (e.g. user logged out).
      mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);

      expect(() => store.getProviders()).toThrow(KeychainUnavailableError);
    });

    it("degrades to apiKey:'' (does NOT throw) when ciphertext is corrupted", () => {
      // Different failure mode: keychain works but the stored bytes are garbage.
      // We want one bad row to NOT take out the whole provider list.
      store.addProvider({
        id: "p1",
        name: "P1",
        enabled: true,
        baseURL: "https://api.example.com",
        apiKey: "sk-secret",
        models: {},
        modelMap: {},
        envOverrides: {},
      });

      mockSafeStorage.decryptString.mockImplementation(() => {
        throw new Error("corrupted ciphertext");
      });

      expect(() => store.getProviders()).not.toThrow();
      const providers = store.getProviders();
      expect(providers).toHaveLength(1);
      expect(providers[0].apiKey).toBe("");
    });
  });

  describe("migrateApiKeys", () => {
    it("is a no-op when there is no plaintext to migrate, regardless of keychain status", () => {
      mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);

      // Fresh store — no providers, no plaintext keys.
      expect(() => store.migrateApiKeys()).not.toThrow();
    });

    it("throws when plaintext apiKey is on disk and keychain is unavailable", () => {
      // Seed a legacy plaintext provider by writing through with keychain working,
      // then mutating the underlying JSON to drop the encryption (simulating an
      // app that pre-dates the migration).
      const legacyProvider = {
        id: "legacy",
        name: "Legacy",
        enabled: true,
        baseURL: "https://api.example.com",
        apiKey: "sk-plaintext",
        models: {},
        modelMap: {},
        envOverrides: {},
      };
      // Use the internal Store via a fresh ConfigStore — easier than reaching in
      // is to bypass encryption by stubbing it.
      mockSafeStorage.encryptString.mockImplementationOnce(() => {
        throw new Error("force plaintext path");
      });
      // The above would throw in addProvider — so instead seed via the internal
      // Store API by recreating with raw JSON. We use the documented escape
      // hatch: write directly through `(store as any)["store"]`.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internal = (store as any).store as {
        set: (key: string, value: unknown) => void;
      };
      internal.set("providers", [legacyProvider]);

      mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);

      expect(() => store.migrateApiKeys()).toThrow(KeychainUnavailableError);
      expect(() => store.migrateApiKeys()).toThrow(/keychain is not available/);
    });

    it("encrypts pending plaintext when keychain is available", () => {
      const legacyProvider = {
        id: "legacy",
        name: "Legacy",
        enabled: true,
        baseURL: "https://api.example.com",
        apiKey: "sk-plaintext",
        models: {},
        modelMap: {},
        envOverrides: {},
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internal = (store as any).store as {
        set: (key: string, value: unknown) => void;
        get: (key: string) => unknown;
      };
      internal.set("providers", [legacyProvider]);

      // Keychain default is available — migration should succeed.
      expect(() => store.migrateApiKeys()).not.toThrow();

      const after = internal.get("providers") as Array<{
        apiKey?: string;
        encryptedApiKey?: string;
      }>;
      expect(after[0].encryptedApiKey).toBeDefined();
      expect(after[0].apiKey).toBeUndefined();
    });
  });
});
