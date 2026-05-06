import { oc } from "@orpc/contract";
import { ORPCError } from "@orpc/server";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

import { defineRouter, defineRouterNoContext } from "../router-factory";

const sampleContract = {
  echo: oc.input(z.object({ value: z.string() })).output(z.object({ value: z.string() })),
};

describe("defineRouter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns os/log/wrapError primitives", () => {
    const result = defineRouter({
      contract: { sample: sampleContract },
      debugNs: "test:router-factory:returns",
    });

    expect(result).toHaveProperty("os");
    expect(result).toHaveProperty("log");
    expect(result).toHaveProperty("wrapError");
    expect(typeof result.wrapError).toBe("function");
  });

  it("creates a debug logger using the provided namespace", () => {
    const { log } = defineRouter({
      contract: { sample: sampleContract },
      debugNs: "test:router-factory:ns",
    });

    expect(log.namespace).toBe("test:router-factory:ns");
  });

  it("falls back to neovate:router when debugNs is omitted", () => {
    const { log } = defineRouter({
      contract: { sample: sampleContract },
    });

    expect(log.namespace).toBe("neovate:router");
  });

  it("wrapError throws ORPCError with BAD_GATEWAY by default", () => {
    const { wrapError } = defineRouter({
      contract: { sample: sampleContract },
      debugNs: "test:router-factory:bad-gateway",
    });

    let caught: unknown;
    try {
      wrapError(new Error("boom"));
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ORPCError);
    const err = caught as ORPCError<string, unknown>;
    expect(err.code).toBe("BAD_GATEWAY");
    expect(err.message).toBe("boom");
    expect(err.defined).toBe(true);
  });

  it("wrapError honours errorCode override", () => {
    const { wrapError } = defineRouter({
      contract: { sample: sampleContract },
      debugNs: "test:router-factory:bad-request",
      errorCode: "BAD_REQUEST",
    });

    let caught: unknown;
    try {
      wrapError(new Error("invalid"));
    } catch (e) {
      caught = e;
    }

    const err = caught as ORPCError<string, unknown>;
    expect(err.code).toBe("BAD_REQUEST");
  });

  it("wrapError prefers per-call fallback over factory fallback for non-Error values", () => {
    const { wrapError } = defineRouter({
      contract: { sample: sampleContract },
      debugNs: "test:router-factory:per-call-fallback",
      fallbackError: "factory default",
    });

    let caught: unknown;
    try {
      wrapError("string-thrown", "per-call message");
    } catch (e) {
      caught = e;
    }

    expect((caught as ORPCError<string, unknown>).message).toBe("per-call message");
  });

  it("wrapError uses factory fallback when neither Error nor per-call fallback is supplied", () => {
    const { wrapError } = defineRouter({
      contract: { sample: sampleContract },
      debugNs: "test:router-factory:factory-fallback",
      fallbackError: "factory default",
    });

    let caught: unknown;
    try {
      wrapError({ unrecognised: true });
    } catch (e) {
      caught = e;
    }

    expect((caught as ORPCError<string, unknown>).message).toBe("factory default");
  });

  it("wrapError uses generic 'Internal error' when nothing is configured", () => {
    const { wrapError } = defineRouter({
      contract: { sample: sampleContract },
      debugNs: "test:router-factory:generic",
    });

    let caught: unknown;
    try {
      wrapError(undefined);
    } catch (e) {
      caught = e;
    }

    expect((caught as ORPCError<string, unknown>).message).toBe("Internal error");
  });

  it("os exposes the implemented contract leaves (nested form)", () => {
    const { os } = defineRouter({
      contract: { sample: sampleContract },
      debugNs: "test:router-factory:nested",
    });

    expect(os).toHaveProperty("sample");
    expect((os as { sample: { echo: unknown } }).sample).toHaveProperty("echo");
  });

  it("defineRouterNoContext returns the flat implementer for unscoped contracts", () => {
    const { os } = defineRouterNoContext({
      contract: sampleContract,
      debugNs: "test:router-factory:flat",
    });

    expect(os).toHaveProperty("echo");
  });

  it("defineRouterNoContext shares wrapError/log surface with defineRouter", () => {
    const { wrapError, log } = defineRouterNoContext({
      contract: sampleContract,
      debugNs: "test:router-factory:flat-shared",
      errorCode: "BAD_REQUEST",
    });

    expect(log.namespace).toBe("test:router-factory:flat-shared");

    let caught: unknown;
    try {
      wrapError(new Error("flat-boom"));
    } catch (e) {
      caught = e;
    }
    expect((caught as ORPCError<string, unknown>).code).toBe("BAD_REQUEST");
    expect((caught as ORPCError<string, unknown>).message).toBe("flat-boom");
  });
});
