import { afterEach, describe, expect, it, vi } from "vitest";

import {
  reportError,
  resetErrorSink,
  setErrorSink,
  withReport,
  type ErrorSink,
} from "../error-reporter";

describe("error-reporter", () => {
  afterEach(() => {
    resetErrorSink();
  });

  describe("reportError", () => {
    it("delivers Error instances unchanged", () => {
      const sink = vi.fn<ErrorSink>();
      setErrorSink(sink);

      const err = new Error("boom");
      reportError(err, { op: "test" });

      expect(sink).toHaveBeenCalledTimes(1);
      expect(sink).toHaveBeenCalledWith(err, { op: "test" });
    });

    it("wraps non-Error throwables in an Error", () => {
      const sink = vi.fn<ErrorSink>();
      setErrorSink(sink);

      reportError("plain string");

      expect(sink).toHaveBeenCalledTimes(1);
      const [err] = sink.mock.calls[0]!;
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe("plain string");
    });

    it("swallows sink-level exceptions", () => {
      setErrorSink(() => {
        throw new Error("sink crashed");
      });

      // Must not throw upward
      expect(() => reportError(new Error("payload"))).not.toThrow();
    });

    it("default sink is a no-op (does not throw)", () => {
      // No setErrorSink before this call
      expect(() => reportError(new Error("nobody listening"))).not.toThrow();
    });
  });

  describe("withReport", () => {
    it("returns the resolved value when the promise succeeds", async () => {
      const sink = vi.fn<ErrorSink>();
      setErrorSink(sink);

      const result = await withReport(Promise.resolve(42));

      expect(result).toBe(42);
      expect(sink).not.toHaveBeenCalled();
    });

    it("returns undefined and reports when the promise rejects", async () => {
      const sink = vi.fn<ErrorSink>();
      setErrorSink(sink);

      const err = new Error("network down");
      const result = await withReport(Promise.reject(err), { op: "fetch" });

      expect(result).toBeUndefined();
      expect(sink).toHaveBeenCalledWith(err, { op: "fetch" });
    });

    it("forwards context to the sink", async () => {
      const sink = vi.fn<ErrorSink>();
      setErrorSink(sink);

      await withReport(Promise.reject(new Error("x")), {
        op: "config.set",
        key: "theme",
      });

      expect(sink).toHaveBeenCalledWith(expect.any(Error), {
        op: "config.set",
        key: "theme",
      });
    });
  });

  describe("setErrorSink / resetErrorSink", () => {
    it("setErrorSink replaces the active sink", () => {
      const sinkA = vi.fn<ErrorSink>();
      const sinkB = vi.fn<ErrorSink>();
      setErrorSink(sinkA);
      reportError(new Error("a"));
      setErrorSink(sinkB);
      reportError(new Error("b"));

      expect(sinkA).toHaveBeenCalledTimes(1);
      expect(sinkB).toHaveBeenCalledTimes(1);
    });

    it("resetErrorSink restores no-op behavior", () => {
      const sink = vi.fn<ErrorSink>();
      setErrorSink(sink);
      resetErrorSink();
      reportError(new Error("ignored"));

      expect(sink).not.toHaveBeenCalled();
    });
  });
});
