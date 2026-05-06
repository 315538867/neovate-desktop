import { describe, expect, it } from "vitest";

import { GitInstaller } from "../git";

/**
 * GitInstaller delegates fetchToTemp to `git clone`, which is heavy to mock
 * end-to-end. The high-value coverage here is `detect()` (so refs route to
 * the right installer) and `parseSourceRef()` (so `git:`, `tree/` and
 * `user/repo` shorthand all resolve to the same canonical URL).
 *
 * `parseSourceRef` is private — exercised indirectly by exposing it via a
 * tiny test subclass.
 */
class TestableGitInstaller extends GitInstaller {
  parse(ref: string): { url: string; branch?: string; subpath?: string } {
    // @ts-expect-error -- accessing private for test
    return this.parseSourceRef(ref);
  }
}

describe("GitInstaller", () => {
  const inst = new TestableGitInstaller();

  describe("detect", () => {
    it("matches git: prefix, https URLs, and user/repo shorthand", () => {
      expect(inst.detect("git:owner/repo")).toBe(true);
      expect(inst.detect("https://github.com/owner/repo")).toBe(true);
      expect(inst.detect("http://example.com/repo.git")).toBe(true);
      expect(inst.detect("owner/repo")).toBe(true);
    });

    it("rejects npm and prebuilt prefixes (so they route elsewhere)", () => {
      expect(inst.detect("npm:my-skill")).toBe(false);
      expect(inst.detect("prebuilt:built-in")).toBe(false);
    });

    it("rejects garbage strings", () => {
      expect(inst.detect("just-a-name")).toBe(false);
      expect(inst.detect("")).toBe(false);
    });
  });

  describe("parseSourceRef", () => {
    it("expands user/repo shorthand to a github https URL", () => {
      expect(inst.parse("octocat/hello")).toEqual({
        url: "https://github.com/octocat/hello.git",
      });
    });

    it("extracts branch + subpath from github tree URLs", () => {
      const parsed = inst.parse("https://github.com/owner/repo/tree/feature-branch/skills/foo");
      expect(parsed).toEqual({
        url: "https://github.com/owner/repo.git",
        branch: "feature-branch",
        subpath: "skills/foo",
      });
    });
  });
});
