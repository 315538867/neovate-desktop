import { describe, expect, it } from "vitest";

import { NpmInstaller } from "../npm";

/**
 * NpmInstaller's heavy paths shell out to `npm pack` / `npm view` (covered
 * by `base.test.ts` lifecycle + integration). What we lock down here:
 *  - `detect()` routes the right refs
 *  - `parseSourceRef()` splits `npm:pkg?registry=...` correctly
 *  - registry resolution honors the default-registry getter and the
 *    explicit `?registry=` override
 *  - resolveRegistry refuses non-whitelisted registries (delegated to
 *    registry-policy, but verified at the choke point)
 */

class TestableNpmInstaller extends NpmInstaller {
  parse(ref: string): { pkg: string; registry?: string } {
    // @ts-expect-error -- accessing private for test
    return this.parseSourceRef(ref);
  }

  resolve(ref: string): { pkg: string; registry?: string } {
    // @ts-expect-error -- accessing private for test
    return this.resolveRegistry(ref);
  }
}

describe("NpmInstaller", () => {
  describe("detect", () => {
    const inst = new TestableNpmInstaller();

    it("matches `npm:` prefix and scoped packages", () => {
      expect(inst.detect("npm:my-pkg")).toBe(true);
      expect(inst.detect("@scope/pkg")).toBe(true);
    });

    it("rejects bare names, git URLs, and prebuilt refs", () => {
      expect(inst.detect("my-pkg")).toBe(false);
      expect(inst.detect("https://github.com/o/r.git")).toBe(false);
      expect(inst.detect("prebuilt:foo")).toBe(false);
    });
  });

  describe("parseSourceRef", () => {
    const inst = new TestableNpmInstaller();

    it("strips the npm: prefix", () => {
      expect(inst.parse("npm:my-pkg")).toEqual({ pkg: "my-pkg" });
    });

    it("extracts ?registry=... when present", () => {
      expect(inst.parse("npm:my-pkg?registry=https://registry.npmjs.org/")).toEqual({
        pkg: "my-pkg",
        registry: "https://registry.npmjs.org/",
      });
    });
  });

  describe("resolveRegistry", () => {
    it("uses the explicit registry from the source ref when provided", () => {
      const inst = new TestableNpmInstaller(() => "https://registry.npmmirror.com/");
      const out = inst.resolve("npm:my-pkg?registry=https://registry.npmjs.org/");
      expect(out).toEqual({
        pkg: "my-pkg",
        registry: "https://registry.npmjs.org/",
      });
    });

    it("falls back to the default-registry getter when the ref lacks a registry", () => {
      const inst = new TestableNpmInstaller(() => "https://registry.npmmirror.com/");
      expect(inst.resolve("npm:my-pkg")).toEqual({
        pkg: "my-pkg",
        registry: "https://registry.npmmirror.com/",
      });
    });

    it("throws when an explicit registry is not on the whitelist", () => {
      const inst = new TestableNpmInstaller();
      expect(() => inst.resolve("npm:my-pkg?registry=https://evil.example.com/")).toThrow(
        /npm registry not allowed/,
      );
    });
  });
});
