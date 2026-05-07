import { describe, expect, it } from "vitest";

import { PrebuiltInstaller } from "../prebuilt";

/**
 * PrebuiltInstaller's heavy paths shell out to `cp -R`/`fs.cp` against the
 * app's bundled resourcesDir. What we lock down here is the pure routing
 * surface — `detect()` accepts only the `prebuilt:` prefix so other refs
 * route to git/npm/clawhub.
 */
describe("PrebuiltInstaller", () => {
  const inst = new PrebuiltInstaller("/fake/resources");

  describe("detect", () => {
    it("matches the prebuilt: prefix", () => {
      expect(inst.detect("prebuilt:hello-world")).toBe(true);
      expect(inst.detect("prebuilt:built-in-pack")).toBe(true);
    });

    it("rejects non-prebuilt refs (so they route elsewhere)", () => {
      expect(inst.detect("npm:my-pkg")).toBe(false);
      expect(inst.detect("git:owner/repo")).toBe(false);
      expect(inst.detect("https://github.com/owner/repo")).toBe(false);
    });

    it("rejects garbage / empty input", () => {
      expect(inst.detect("")).toBe(false);
      expect(inst.detect("just-a-name")).toBe(false);
    });
  });
});
