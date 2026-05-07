import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The fetch-interceptor module is a side-effecting bundle: importing it
 * monkey-patches `globalThis.fetch` and writes a `__NV_READY\n` handshake
 * line to fd 3. We cannot test it like a normal module — we have to:
 *  1) install fakes for fs.writeSync / fs.write / globalThis.fetch BEFORE
 *     the module loads,
 *  2) clear the `__nvInterceptorInstalled` global between tests so the
 *     setup() body actually re-runs,
 *  3) re-import via vi.resetModules() each time.
 *
 * Coverage targets (per plan §8.1):
 *  - install-guard prevents double-patching
 *  - patched fetch passes through non-Anthropic URLs unchanged
 *  - patched fetch intercepts Anthropic URLs (api.anthropic.com host)
 *  - patched fetch falls back on URL miss but Anthropic-specific headers
 *    present (custom provider path)
 *  - patched fetch extracts headers from a plain object init
 *  - patched fetch extracts headers from a Headers instance
 *  - patched fetch extracts headers from a [k,v][] tuple init
 *  - emit-on-error: a thrown originalFetch still emits an `end` line with
 *    the error field
 */

const FD_LINES: string[] = [];

async function loadInterceptor(): Promise<{
  patchedFetch: typeof globalThis.fetch;
  originalFetch: ReturnType<typeof vi.fn>;
}> {
  // Reset state
  FD_LINES.length = 0;
  delete (globalThis as any).__nvInterceptorInstalled;

  // Mock fs to capture interceptor output instead of writing to a real fd 3
  vi.doMock("node:fs", () => ({
    default: {
      writeSync: (_fd: number, line: string): number => {
        FD_LINES.push(line);
        return line.length;
      },
      write: (_fd: number, line: string, cb: (err: Error | null) => void): void => {
        FD_LINES.push(line);
        cb(null);
      },
    },
    writeSync: (_fd: number, line: string): number => {
      FD_LINES.push(line);
      return line.length;
    },
    write: (_fd: number, line: string, cb: (err: Error | null) => void): void => {
      FD_LINES.push(line);
      cb(null);
    },
  }));

  // Install a tracked originalFetch that the interceptor will wrap
  const originalFetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response("ok", { status: 200, headers: { "x-test": "1" } }),
  );
  globalThis.fetch = originalFetch as unknown as typeof globalThis.fetch;

  vi.resetModules();
  // Importing the module triggers setup() which monkey-patches globalThis.fetch
  await import("../fetch-interceptor");

  return { patchedFetch: globalThis.fetch, originalFetch };
}

describe("fetch-interceptor", () => {
  let savedFetch: typeof globalThis.fetch;

  beforeEach(() => {
    savedFetch = globalThis.fetch;
    delete (globalThis as any).__nvInterceptorInstalled;
  });

  afterEach(() => {
    globalThis.fetch = savedFetch;
    vi.doUnmock("node:fs");
    vi.resetModules();
    delete (globalThis as any).__nvInterceptorInstalled;
  });

  it("emits the __NV_READY handshake on first install and patches globalThis.fetch", async () => {
    const { patchedFetch, originalFetch } = await loadInterceptor();
    expect(FD_LINES).toContain("__NV_READY\n");
    expect(patchedFetch).not.toBe(originalFetch);
  });

  it("guards against double install — second import does not re-run setup()", async () => {
    await loadInterceptor();
    const handshakesAfterFirst = FD_LINES.filter((l) => l === "__NV_READY\n").length;
    expect(handshakesAfterFirst).toBe(1);

    // Second import — guard flag is already set, so setup() must not run again
    vi.resetModules();
    await import("../fetch-interceptor");
    const handshakesAfterSecond = FD_LINES.filter((l) => l === "__NV_READY\n").length;
    expect(handshakesAfterSecond).toBe(1);
  });

  it("passes non-Anthropic URLs straight through to originalFetch", async () => {
    const { patchedFetch, originalFetch } = await loadInterceptor();
    await patchedFetch("https://example.com/some-api");
    expect(originalFetch).toHaveBeenCalledTimes(1);
    // No __NV_REQ start line should be emitted for a non-Anthropic URL
    const reqLines = FD_LINES.filter((l) => l.startsWith("__NV_REQ:"));
    expect(reqLines).toHaveLength(0);
  });

  it("intercepts Anthropic URLs (host match) and emits a start summary", async () => {
    const { patchedFetch } = await loadInterceptor();
    await patchedFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": "sk-test" },
      body: JSON.stringify({ model: "claude-opus-4-6", stream: false, messages: [] }),
    });
    const startLines = FD_LINES.filter(
      (l) => l.startsWith("__NV_REQ:") && l.includes('"phase":"start"'),
    );
    expect(startLines.length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to header detection on a non-Anthropic host (custom provider path)", async () => {
    const { patchedFetch } = await loadInterceptor();
    await patchedFetch("https://my-proxy.example.com/v1/messages", {
      method: "POST",
      headers: { "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-opus-4-6" }),
    });
    const startLines = FD_LINES.filter(
      (l) => l.startsWith("__NV_REQ:") && l.includes('"phase":"start"'),
    );
    expect(startLines.length).toBeGreaterThanOrEqual(1);
  });

  it("extracts headers from a Headers instance", async () => {
    const { patchedFetch } = await loadInterceptor();
    const h = new Headers();
    h.set("anthropic-version", "2023-06-01");
    await patchedFetch("https://my-proxy.example.com/v1/messages", {
      method: "POST",
      headers: h,
    });
    const startLines = FD_LINES.filter(
      (l) => l.startsWith("__NV_REQ:") && l.includes('"phase":"start"'),
    );
    expect(startLines.length).toBeGreaterThanOrEqual(1);
  });

  it("extracts headers from a [k,v][] tuple init", async () => {
    const { patchedFetch } = await loadInterceptor();
    await patchedFetch("https://my-proxy.example.com/v1/messages", {
      method: "POST",
      headers: [["anthropic-version", "2023-06-01"]],
    });
    const startLines = FD_LINES.filter(
      (l) => l.startsWith("__NV_REQ:") && l.includes('"phase":"start"'),
    );
    expect(startLines.length).toBeGreaterThanOrEqual(1);
  });

  it("emits an end line with error field when originalFetch throws", async () => {
    // Reset & install a throwing originalFetch
    FD_LINES.length = 0;
    delete (globalThis as any).__nvInterceptorInstalled;

    vi.doMock("node:fs", () => ({
      default: {
        writeSync: (_fd: number, line: string) => {
          FD_LINES.push(line);
          return line.length;
        },
        write: (_fd: number, line: string, cb: (err: Error | null) => void): void => {
          FD_LINES.push(line);
          cb(null);
        },
      },
      writeSync: (_fd: number, line: string) => {
        FD_LINES.push(line);
        return line.length;
      },
      write: (_fd: number, line: string, cb: (err: Error | null) => void): void => {
        FD_LINES.push(line);
        cb(null);
      },
    }));

    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof globalThis.fetch;

    vi.resetModules();
    await import("../fetch-interceptor");

    await expect(
      globalThis.fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        body: JSON.stringify({ model: "claude-opus-4-6" }),
      }),
    ).rejects.toThrow("network down");

    const endLines = FD_LINES.filter(
      (l) => l.startsWith("__NV_REQ:") && l.includes('"phase":"end"') && l.includes('"error"'),
    );
    expect(endLines.length).toBeGreaterThanOrEqual(1);
  });
});
