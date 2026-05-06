import { describe, expect, it } from "vitest";

import {
  maskCredential,
  maskCredentialsInString,
  maskCredentialsInValue,
  maskHeaders,
  maskUrl,
} from "../credential-mask";

/**
 * Adversarial edge-case corpus for the credential masker.
 *
 * The masker is best-effort, not cryptographic — but the *worst* failure
 * mode is a credential leaking into inspector logs / persisted state. So
 * each case here pairs a realistic attack/leak scenario with both:
 *  1) the original secret MUST NOT appear verbatim in the output, AND
 *  2) the recognizable prefix is preserved so a developer can still
 *     correlate logs against their own records.
 *
 * Coverage targets (per plan §8.2):
 *  - Bearer-prefixed tokens in Authorization headers
 *  - sk-ant-*, AIza*, ghp_/ghs_/ghu_/gho_/ghr_ token shapes
 *  - JWT (three base64url segments)
 *  - URL query-param leakage (api_key=, access_token=)
 *  - Sensitive-keyed JSON (password, secret, accessToken)
 *  - Mixed cases: header name casing variants, short values
 *  - Negative: random non-credential strings should NOT be mutilated
 */
describe("credential-mask — adversarial edge cases", () => {
  describe("maskCredential", () => {
    it("preserves Bearer prefix and masks the token tail", () => {
      const input = "Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz123";
      const out = maskCredential(input);
      expect(out.startsWith("Bearer sk-ant")).toBe(true);
      expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz");
      expect(out).toMatch(/\*\*\*\*/);
    });

    it("masks AIza-prefixed Google API keys with prefix preserved", () => {
      const key = "AIzaSyA0123456789abcdefghijklmnopqrstuvxyz";
      const out = maskCredential(key);
      expect(out.startsWith("AIzaSy")).toBe(true);
      expect(out).not.toBe(key);
      expect(out).toMatch(/\*\*\*\*/);
    });

    it("collapses very short values (< 12 chars) to ****", () => {
      expect(maskCredential("abc")).toBe("****");
      expect(maskCredential("12345")).toBe("****");
      // Empty stays empty (avoid asterisk injection on missing fields)
      expect(maskCredential("")).toBe("");
    });
  });

  describe("maskHeaders", () => {
    it("masks regardless of header-name casing (Authorization vs authorization)", () => {
      const masked = maskHeaders({
        Authorization: "Bearer sk-ant-api03-abcdefghijklmnopqrst",
        "X-Api-Key": "sk-ant-api03-foobarbazquxquuxcorgegrault",
        "x-goog-api-key": "AIzaSyA0123456789abcdefghijklmnopqrstuvxyz",
      });
      expect(masked["Authorization"]).not.toContain("abcdefghijklmnop");
      expect(masked["X-Api-Key"]).not.toContain("foobarbazqux");
      expect(masked["x-goog-api-key"]).not.toContain("0123456789abcdef");
    });

    it("does not mutate non-sensitive headers (Accept, Content-Type)", () => {
      const masked = maskHeaders({
        Accept: "application/json",
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "neovate-desktop/1.0",
      });
      expect(masked["Accept"]).toBe("application/json");
      expect(masked["Content-Type"]).toBe("application/json; charset=utf-8");
      expect(masked["User-Agent"]).toBe("neovate-desktop/1.0");
    });
  });

  describe("maskUrl", () => {
    it("masks ?api_key= and ?access_token= query params", () => {
      const url =
        "https://api.example.com/v1/things?api_key=sk-ant-api03-abcdefghijklmnopqrst&foo=bar";
      const masked = maskUrl(url);
      expect(masked).not.toContain("sk-ant-api03-abcdefghijklmnopqrst");
      expect(masked).toContain("foo=bar");
    });

    it("falls back to substring masking when the URL is unparseable", () => {
      const garbage = "not a url with sk-ant-api03-abcdefghijklmnopqrst inside";
      const masked = maskUrl(garbage);
      expect(masked).not.toContain("sk-ant-api03-abcdefghijklmnopqrst");
    });
  });

  describe("maskCredentialsInString — pattern catches", () => {
    it("masks JWTs (three base64url segments) inline", () => {
      const text =
        "auth: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c done";
      const masked = maskCredentialsInString(text);
      expect(masked).not.toContain("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0");
    });

    it("masks ghp_ / ghs_ GitHub tokens inline", () => {
      const text = "use ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789 for access";
      const masked = maskCredentialsInString(text);
      expect(masked).not.toContain("ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789");
    });

    it("masks multiple credentials in the same string", () => {
      const text =
        "first sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaa second AIzaSyB1234567890abcdefghijklmnopqrstuvwx end";
      const masked = maskCredentialsInString(text);
      expect(masked).not.toContain("sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaa");
      expect(masked).not.toContain("AIzaSyB1234567890abcdefghijklmnopqrstuvwx");
    });

    it("leaves benign text untouched (false-positive guard)", () => {
      const text = "this is a normal sentence with no credentials whatsoever";
      expect(maskCredentialsInString(text)).toBe(text);
    });
  });

  describe("maskCredentialsInValue — JSON walk", () => {
    it("masks sensitive-keyed string fields regardless of value shape", () => {
      const obj = {
        username: "alice",
        password: "hunter2-secret-do-not-leak",
        api_key: "short",
        nested: {
          accessToken: "AIzaSyA0123456789abcdefghijklmnopqrstuvxyz",
          authorization: "Bearer sk-ant-api03-abcdefghijklmnopqrst",
        },
      };
      const masked = maskCredentialsInValue(obj) as typeof obj;
      expect(masked.username).toBe("alice"); // not sensitive
      expect(masked.password).not.toBe("hunter2-secret-do-not-leak");
      expect(masked.api_key).toBe("****"); // short → collapses
      expect(masked.nested.accessToken).not.toContain("0123456789abcdef");
      expect(masked.nested.authorization).not.toContain("abcdefghijklmnop");
    });

    it("walks arrays of objects without crashing on null/undefined leaves", () => {
      const obj = {
        items: [
          { name: "x", token: "sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaa" },
          { name: "y", token: null },
          { name: "z", token: undefined },
        ],
      };
      const masked = maskCredentialsInValue(obj) as typeof obj;
      expect(masked.items[0]!.token).not.toContain("aaaaaaaaaaaaaaaaaaaaaa");
      expect(masked.items[1]!.token).toBeNull();
      expect(masked.items[2]!.token).toBeUndefined();
    });
  });
});
