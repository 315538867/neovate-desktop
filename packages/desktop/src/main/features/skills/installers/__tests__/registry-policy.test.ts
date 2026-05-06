import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertRegistryAllowed,
  DEFAULT_REGISTRY_WHITELIST,
  getRegistryWhitelist,
  isAllowedRegistry,
} from "../registry-policy";

describe("registry-policy", () => {
  const originalEnv = process.env.NEOVATE_NPM_REGISTRY_ALLOW;

  beforeEach(() => {
    delete process.env.NEOVATE_NPM_REGISTRY_ALLOW;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NEOVATE_NPM_REGISTRY_ALLOW;
    } else {
      process.env.NEOVATE_NPM_REGISTRY_ALLOW = originalEnv;
    }
  });

  describe("DEFAULT_REGISTRY_WHITELIST", () => {
    it("contains the two known-good public registries", () => {
      expect(DEFAULT_REGISTRY_WHITELIST).toEqual([
        "https://registry.npmjs.org/",
        "https://registry.npmmirror.com/",
      ]);
    });
  });

  describe("isAllowedRegistry", () => {
    it("allows the empty string (means: use npm default)", () => {
      expect(isAllowedRegistry("")).toBe(true);
    });

    it("allows the official npm registry", () => {
      expect(isAllowedRegistry("https://registry.npmjs.org/")).toBe(true);
    });

    it("allows the npmmirror registry", () => {
      expect(isAllowedRegistry("https://registry.npmmirror.com/")).toBe(true);
    });

    it("rejects an unknown https registry", () => {
      expect(isAllowedRegistry("https://evil.example.com/")).toBe(false);
    });

    it("rejects http:// (must be https)", () => {
      expect(isAllowedRegistry("http://registry.npmjs.org/")).toBe(false);
    });

    it("rejects file:// urls", () => {
      expect(isAllowedRegistry("file:///etc/passwd")).toBe(false);
    });

    it("rejects data: urls", () => {
      expect(isAllowedRegistry("data:text/plain,hello")).toBe(false);
    });

    it("rejects javascript: urls", () => {
      expect(isAllowedRegistry("javascript:alert(1)")).toBe(false);
    });

    it("rejects unparseable garbage strings", () => {
      expect(isAllowedRegistry("not-a-url")).toBe(false);
    });

    it("is case-insensitive on host", () => {
      expect(isAllowedRegistry("https://REGISTRY.NPMJS.ORG/")).toBe(true);
    });

    it("is trailing-slash-insensitive", () => {
      expect(isAllowedRegistry("https://registry.npmjs.org")).toBe(true);
    });

    it("does NOT allow subdomain spoofing", () => {
      expect(isAllowedRegistry("https://registry.npmjs.org.evil.com/")).toBe(false);
    });

    it("does NOT allow path-based spoofing", () => {
      // host stays evil.com regardless of path component
      expect(isAllowedRegistry("https://evil.com/registry.npmjs.org/")).toBe(false);
    });
  });

  describe("NEOVATE_NPM_REGISTRY_ALLOW env extension", () => {
    it("allows registries listed in env", () => {
      process.env.NEOVATE_NPM_REGISTRY_ALLOW = "https://internal.corp.example.com/";
      expect(isAllowedRegistry("https://internal.corp.example.com/")).toBe(true);
    });

    it("supports comma-separated list", () => {
      process.env.NEOVATE_NPM_REGISTRY_ALLOW = "https://a.example.com/, https://b.example.com/";
      expect(isAllowedRegistry("https://a.example.com/")).toBe(true);
      expect(isAllowedRegistry("https://b.example.com/")).toBe(true);
      expect(isAllowedRegistry("https://c.example.com/")).toBe(false);
    });

    it("ignores empty entries in env", () => {
      process.env.NEOVATE_NPM_REGISTRY_ALLOW = ",,  ,";
      expect(getRegistryWhitelist()).toEqual(DEFAULT_REGISTRY_WHITELIST);
    });

    it("env additions do NOT downgrade https requirement", () => {
      process.env.NEOVATE_NPM_REGISTRY_ALLOW = "http://insecure.example.com/";
      expect(isAllowedRegistry("http://insecure.example.com/")).toBe(false);
    });
  });

  describe("assertRegistryAllowed", () => {
    it("returns void on allowed registries", () => {
      expect(() => assertRegistryAllowed("")).not.toThrow();
      expect(() => assertRegistryAllowed("https://registry.npmjs.org/")).not.toThrow();
    });

    it("throws with descriptive message on disallowed registries", () => {
      expect(() => assertRegistryAllowed("https://evil.example.com/")).toThrow(
        /npm registry not allowed/,
      );
      expect(() => assertRegistryAllowed("https://evil.example.com/")).toThrow(
        /NEOVATE_NPM_REGISTRY_ALLOW/,
      );
    });

    it("throws on http:// inputs", () => {
      expect(() => assertRegistryAllowed("http://registry.npmjs.org/")).toThrow(/not allowed/);
    });
  });
});
