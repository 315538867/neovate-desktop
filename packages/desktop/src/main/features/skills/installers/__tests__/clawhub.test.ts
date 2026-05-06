import { describe, expect, it } from "vitest";

import { ClawhubInstaller } from "../clawhub";

/**
 * ClawhubInstaller's heavy paths fetch a zip from clawhub.ai and extract it
 * via safeExtractZip (the latter has its own zip-slip corpus elsewhere).
 *
 * The high-value coverage here is the pure routing/parsing surface:
 *  - `detect()` accepts the `clawhub:` prefix and the `https://clawhub.ai/...`
 *    URL form, and rejects everything else.
 *  - `parseRef()` (private, exposed via test subclass) splits both forms
 *    correctly, including the `@version` suffix and the `?version=` query
 *    param.
 *  - `normalize()` collapses the URL form back to the canonical `clawhub:slug`.
 */
class TestableClawhubInstaller extends ClawhubInstaller {
  parse(ref: string): { slug: string; version?: string } {
    // @ts-expect-error -- accessing private for test
    return this.parseRef(ref);
  }
}

describe("ClawhubInstaller", () => {
  const inst = new TestableClawhubInstaller();

  describe("detect", () => {
    it("matches both clawhub: and https://clawhub.ai/ forms", () => {
      expect(inst.detect("clawhub:my-skill")).toBe(true);
      expect(inst.detect("https://clawhub.ai/owner/my-skill")).toBe(true);
    });

    it("rejects npm/git/prebuilt prefixes (so they route elsewhere)", () => {
      expect(inst.detect("npm:my-pkg")).toBe(false);
      expect(inst.detect("git:owner/repo")).toBe(false);
      expect(inst.detect("prebuilt:foo")).toBe(false);
      expect(inst.detect("https://github.com/owner/repo")).toBe(false);
    });
  });

  describe("parseRef", () => {
    it("splits clawhub:slug@version", () => {
      expect(inst.parse("clawhub:my-skill@1.2.3")).toEqual({
        slug: "my-skill",
        version: "1.2.3",
      });
    });

    it("returns just the slug when no version suffix is present", () => {
      expect(inst.parse("clawhub:my-skill")).toEqual({ slug: "my-skill" });
    });

    it("extracts slug + version from the https URL form", () => {
      expect(inst.parse("https://clawhub.ai/octocat/my-skill?version=2.0.0")).toEqual({
        slug: "my-skill",
        version: "2.0.0",
      });
    });
  });

  describe("normalize", () => {
    it("rewrites a URL form back to canonical clawhub:slug", () => {
      expect(inst.normalize("https://clawhub.ai/octocat/my-skill")).toBe("clawhub:my-skill");
    });
  });
});
