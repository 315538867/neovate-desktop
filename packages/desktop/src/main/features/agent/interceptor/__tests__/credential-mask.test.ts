import { describe, expect, it } from "vitest";

import {
  maskCredential,
  maskCredentialsInString,
  maskCredentialsInValue,
  maskHeaders,
  maskUrl,
} from "../credential-mask";

describe("maskCredential", () => {
  it("masks sk- prefixed keys keeping prefix and suffix", () => {
    expect(maskCredential("sk-ant-api03-abcdefghijklmnopxyz")).toBe("sk-ant****xyz");
  });

  it("masks AIza Google keys", () => {
    expect(maskCredential("AIzaSyA1B2C3D4E5F6G7H8I9J0KLMNOxyz")).toBe("AIzaSy****xyz");
  });

  it("masks Bearer prefix passes through to token", () => {
    expect(maskCredential("Bearer sk-ant-api03-abcdefghxyz")).toBe("Bearer sk-ant****xyz");
  });

  it("returns **** for short values", () => {
    expect(maskCredential("short")).toBe("****");
  });

  it("masks generic long opaque tokens", () => {
    expect(maskCredential("abcdef1234567890ghijklmnop")).toBe("abcd****nop");
  });
});

describe("maskHeaders", () => {
  it("masks known sensitive headers regardless of case", () => {
    const out = maskHeaders({
      Authorization: "Bearer sk-ant-api03-abcdefghxyz",
      "X-Api-Key": "sk-ant-api03-abcdefghxyz",
      "X-Goog-Api-Key": "AIzaSyA1B2C3D4E5F6G7H8I9J0KLMNOxyz",
      Cookie: "session=abcdef1234567890ghijxyz",
      "Content-Type": "application/json",
    });
    expect(out.Authorization).toBe("Bearer sk-ant****xyz");
    expect(out["X-Api-Key"]).toBe("sk-ant****xyz");
    expect(out["X-Goog-Api-Key"]).toBe("AIzaSy****xyz");
    expect(out.Cookie).toBe("sess****xyz");
    expect(out["Content-Type"]).toBe("application/json");
  });
});

describe("maskUrl", () => {
  it("masks credentials in known query params", () => {
    const masked = maskUrl(
      "https://example.com/v1?api_key=AIzaSyA1B2C3D4E5F6G7H8I9J0KLMNOxyz&q=hello",
    );
    expect(masked).toContain("api_key=AIzaSy");
    expect(masked).not.toContain("AIzaSyA1B2C3D4E5F6G7H8I9J0KLMNO");
    expect(masked).toContain("q=hello");
  });

  it("preserves URL when no sensitive params present", () => {
    const url = "https://example.com/v1?model=claude-3";
    expect(maskUrl(url)).toBe(url);
  });

  it("falls back to in-string masking on unparsable input", () => {
    expect(maskUrl("not a url sk-ant-api03-abcdefghxyz")).toContain("sk-ant****xyz");
  });
});

describe("maskCredentialsInString", () => {
  it("masks sk-, AIza, gh*, and JWT patterns inside arbitrary text", () => {
    const text =
      "key=sk-ant-api03-abcdefghxyz token=ghp_abcdefghijklmnopqrstuvwxyz1234 jwt=eyJhbGciOi.eyJzdWIi.signature123";
    const out = maskCredentialsInString(text);
    expect(out).not.toContain("sk-ant-api03-abcdefghxyz");
    expect(out).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz1234");
    expect(out).not.toContain("eyJhbGciOi.eyJzdWIi.signature123");
    expect(out).toMatch(/sk-ant\*\*\*\*/);
    expect(out).toMatch(/ghp_\*\*\*\*/);
  });

  it("leaves non-credential text alone", () => {
    expect(maskCredentialsInString("hello world")).toBe("hello world");
  });
});

describe("maskCredentialsInValue", () => {
  it("walks objects and masks sensitive keys", () => {
    const out = maskCredentialsInValue({
      api_key: "sk-ant-api03-abcdefghxyz",
      nested: { password: "supersecretvalue", note: "ok" },
      list: ["sk-ant-api03-abcdefghxyz", "plain"],
    });
    expect(out).toEqual({
      api_key: "sk-ant****xyz",
      nested: { password: "supe****lue", note: "ok" },
      list: ["sk-ant****xyz", "plain"],
    });
  });

  it("masks credential patterns even in non-sensitive keys", () => {
    const out = maskCredentialsInValue({ note: "see sk-ant-api03-abcdefghxyz" });
    expect((out as { note: string }).note).toMatch(/sk-ant\*\*\*\*/);
  });
});
