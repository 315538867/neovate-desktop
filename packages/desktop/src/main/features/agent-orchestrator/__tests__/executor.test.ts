/**
 * Wave 3.2 commit 2.1 — DAG executor unit tests.
 *
 * Covers the orchestrator's tick-loop behaviour without touching real
 * Claude / LLM services. We register stub executors against the
 * shared `Executor` interface and assert ordering, fan-out, abort,
 * and error propagation.
 */

import { describe, expect, it, vi } from "vitest";

import type {
  PipelineTemplate,
  StageNode,
} from "../../../../shared/features/agent-orchestrator/types";
import type { Executor, ExecutorContext, ExecutorInput, ExecutorResult } from "../executors/types";

import { validateDag } from "../dag/dag-validator";
import { interpolateTemplate, StageExecutor } from "../executor";
import { ExecutorRegistry } from "../executors/registry";
import { detectConflicts } from "../fanout/conflict-detector";
import { aggregate, getAggregator } from "../fanout/fanin-aggregator-registry";
import { expandFanout } from "../fanout/fanout-expander";
import { safeEvalCondition, SafeEvalSyntaxError } from "../fanout/safe-condition-evaluator";

function makeStage(partial: Partial<StageNode> & Pick<StageNode, "id">): StageNode {
  return {
    id: partial.id,
    kind: partial.kind ?? "implementer",
    executor: partial.executor ?? "llm-only",
    dependsOn: partial.dependsOn ?? [],
    prompt: partial.prompt ?? `do ${partial.id}`,
    userGate: false,
    label: partial.label,
    model: partial.model,
    budget: partial.budget,
    sandbox: partial.sandbox,
    fanout: partial.fanout,
  };
}

function makeTemplate(stages: StageNode[]): PipelineTemplate {
  return {
    id: "test-template",
    name: "test",
    description: "",
    version: "1.0.0",
    stages,
    source: "user",
  };
}

// ── DAG validator ───────────────────────────────────────────────────

describe("validateDag", () => {
  it("returns topological order for linear chains", () => {
    const tpl = makeTemplate([
      makeStage({ id: "a" }),
      makeStage({ id: "b", dependsOn: ["a"] }),
      makeStage({ id: "c", dependsOn: ["b"] }),
    ]);
    const result = validateDag(tpl);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order).toEqual(["a", "b", "c"]);
  });

  it("detects duplicate stage ids", () => {
    const tpl = makeTemplate([makeStage({ id: "a" }), makeStage({ id: "a" })]);
    const result = validateDag(tpl);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("duplicate-stage-id");
      expect(result.offenders).toContain("a");
    }
  });

  it("detects missing dependencies", () => {
    const tpl = makeTemplate([makeStage({ id: "a", dependsOn: ["zzz"] })]);
    const result = validateDag(tpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing-dependency");
  });

  it("detects cycles", () => {
    const tpl = makeTemplate([
      makeStage({ id: "a", dependsOn: ["b"] }),
      makeStage({ id: "b", dependsOn: ["a"] }),
    ]);
    const result = validateDag(tpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("cycle");
  });

  it("rejects empty pipelines", () => {
    const tpl = makeTemplate([]);
    const result = validateDag(tpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("empty-stages");
  });

  it("rejects self-dependency", () => {
    const tpl = makeTemplate([makeStage({ id: "a", dependsOn: ["a"] })]);
    const result = validateDag(tpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("self-dependency");
  });

  it("topo-orders diamond graphs deterministically", () => {
    const tpl = makeTemplate([
      makeStage({ id: "root" }),
      makeStage({ id: "left", dependsOn: ["root"] }),
      makeStage({ id: "right", dependsOn: ["root"] }),
      makeStage({ id: "join", dependsOn: ["left", "right"] }),
    ]);
    const result = validateDag(tpl);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order[0]).toBe("root");
      expect(result.order[3]).toBe("join");
      // Stable order: declared position determines tie-break.
      expect(result.order).toEqual(["root", "left", "right", "join"]);
    }
  });
});

// ── Fan-out expander ────────────────────────────────────────────────

describe("expandFanout", () => {
  it("returns a single branch for stages without fanout", () => {
    const stage = makeStage({ id: "x" });
    const branches = expandFanout(stage, { upstreamOutputs: new Map() });
    expect(branches).toEqual([{ branchIndex: 0, vars: {}, source: undefined }]);
  });

  it("emits one branch per static variant", () => {
    const stage = makeStage({
      id: "x",
      fanout: { kind: "static", variants: ["a", "b", "c"] },
    });
    const branches = expandFanout(stage, { upstreamOutputs: new Map() });
    expect(branches).toHaveLength(3);
    expect(branches.map((b) => b.vars._variant)).toEqual(["a", "b", "c"]);
  });

  it("expands input fanout from upstream payload", () => {
    const stage = makeStage({
      id: "x",
      dependsOn: ["src"],
      fanout: { kind: "input", path: "items", maxBranches: 8 },
    });
    const upstream = new Map([
      [
        "src#0",
        {
          payload: { items: [{ name: "alpha" }, { name: "beta" }] },
          changedFiles: [],
        },
      ],
    ]);
    const branches = expandFanout(stage, {
      upstreamOutputs: upstream,
      defaultSourceStageId: "src",
    });
    expect(branches).toHaveLength(2);
    expect(branches[0]?.vars.name).toBe("alpha");
    expect(branches[1]?.vars.name).toBe("beta");
  });

  it("caps branches at maxBranches", () => {
    const stage = makeStage({
      id: "x",
      dependsOn: ["src"],
      fanout: { kind: "input", path: "items", maxBranches: 2 },
    });
    const upstream = new Map([
      ["src#0", { payload: { items: ["a", "b", "c", "d"] }, changedFiles: [] }],
    ]);
    const branches = expandFanout(stage, {
      upstreamOutputs: upstream,
      defaultSourceStageId: "src",
    });
    expect(branches).toHaveLength(2);
  });
});

// ── Conflict detector ───────────────────────────────────────────────

describe("detectConflicts", () => {
  it("flags overlapping changedFiles", () => {
    const branches = [
      {
        branchIndex: 0,
        output: { changedFiles: ["src/a.ts", "src/shared.ts"], payload: undefined },
      },
      {
        branchIndex: 1,
        output: { changedFiles: ["src/b.ts", "src/shared.ts"], payload: undefined },
      },
    ];
    const report = detectConflicts(branches);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]).toMatchObject({
      path: "src/shared.ts",
      branches: [0, 1],
    });
    expect(report.uniquePaths).toContain("src/a.ts");
    expect(report.uniquePaths).toContain("src/b.ts");
  });

  it("normalises Windows paths", () => {
    const branches = [
      { branchIndex: 0, output: { changedFiles: ["src\\a.ts"], payload: undefined } },
      { branchIndex: 1, output: { changedFiles: ["src/a.ts"], payload: undefined } },
    ];
    const report = detectConflicts(branches);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]?.path).toBe("src/a.ts");
  });
});

// ── Aggregator registry ─────────────────────────────────────────────

describe("aggregate", () => {
  it("falls back to concat when name is unknown", () => {
    const merged = aggregate(undefined, [
      { branchIndex: 0, output: { summary: "one", changedFiles: ["a"], payload: 1 } },
      { branchIndex: 1, output: { summary: "two", changedFiles: ["b"], payload: 2 } },
    ]);
    expect(merged.summary).toBe("one\n\ntwo");
    expect(merged.changedFiles).toEqual(["a", "b"]);
    expect(merged.payload).toEqual([1, 2]);
  });

  it("first picks the lowest branchIndex", () => {
    const fn = getAggregator("first");
    expect(fn).toBeDefined();
    const merged = fn!([
      { branchIndex: 1, output: { summary: "second", changedFiles: [], payload: "second" } },
      { branchIndex: 0, output: { summary: "first", changedFiles: [], payload: "first" } },
    ]);
    expect(merged.payload).toBe("first");
  });
});

// ── Safe condition evaluator ────────────────────────────────────────

describe("safeEvalCondition", () => {
  it("evaluates equality and logical ops", () => {
    expect(safeEvalCondition("status === 'ok'", { status: "ok" })).toBe(true);
    expect(safeEvalCondition("count > 0 && active === true", { count: 3, active: true })).toBe(
      true,
    );
    expect(safeEvalCondition("!fail || retries > 0", { fail: true, retries: 0 })).toBe(false);
  });

  it("supports nested paths", () => {
    expect(safeEvalCondition("user.role === 'admin'", { user: { role: "admin" } })).toBe(true);
  });

  it("rejects function calls and other unsafe syntax", () => {
    expect(() => safeEvalCondition("process.exit(0)", {})).toThrow(SafeEvalSyntaxError);
    expect(() => safeEvalCondition("a[0]", { a: [1] })).toThrow(SafeEvalSyntaxError);
  });
});

// ── interpolateTemplate ─────────────────────────────────────────────

describe("interpolateTemplate", () => {
  it("substitutes named placeholders", () => {
    expect(interpolateTemplate("hello {{name}}", { name: "world" })).toBe("hello world");
  });

  it("leaves unresolved placeholders as-is", () => {
    expect(interpolateTemplate("hello {{name}}", {})).toBe("hello {{name}}");
  });

  it("handles whitespace inside braces", () => {
    expect(interpolateTemplate("{{ name }}", { name: "a" })).toBe("a");
  });
});

// ── StageExecutor — integration with stub executors ─────────────────

class StubExecutor implements Executor {
  readonly kind = "llm-only" as const;
  readonly seen: string[] = [];

  constructor(private readonly responses: Map<string, ExecutorResult>) {}

  async execute(input: ExecutorInput, _ctx: ExecutorContext): Promise<ExecutorResult> {
    this.seen.push(`${input.stage.id}#${input.branchIndex}`);
    const response = this.responses.get(input.stage.id) ?? defaultResult();
    return response;
  }
}

class FailingExecutor implements Executor {
  readonly kind = "llm-only" as const;
  constructor(private readonly failOn: string) {}
  async execute(input: ExecutorInput, _ctx: ExecutorContext): Promise<ExecutorResult> {
    if (input.stage.id === this.failOn) {
      throw new Error(`stage ${input.stage.id} blew up`);
    }
    return defaultResult();
  }
}

class HangingExecutor implements Executor {
  readonly kind = "llm-only" as const;
  async execute(input: ExecutorInput, _ctx: ExecutorContext): Promise<ExecutorResult> {
    return new Promise<ExecutorResult>((_resolve, reject) => {
      // Hangs forever unless the orchestrator aborts the stage signal.
      const onAbort = () => {
        reject(new Error(`[abort] ${String(input.signal.reason ?? "aborted")}`));
      };
      if (input.signal.aborted) {
        onAbort();
        return;
      }
      input.signal.addEventListener("abort", onAbort);
    });
  }
}

function defaultResult(): ExecutorResult {
  return {
    output: { payload: { ok: true }, summary: "stub", changedFiles: [] },
    usage: { usedTokens: 10, usedDurationMs: 5, usedCostUsd: 0, completedStages: 1 },
  };
}

describe("StageExecutor.run", () => {
  it("runs a linear pipeline in topological order", async () => {
    const stub = new StubExecutor(new Map());
    const registry = new ExecutorRegistry();
    registry.register(stub);

    const exec = new StageExecutor({ registry });
    const tpl = makeTemplate([
      makeStage({ id: "a" }),
      makeStage({ id: "b", dependsOn: ["a"] }),
      makeStage({ id: "c", dependsOn: ["b"] }),
    ]);

    const run = await exec.run({ runId: "r1", template: tpl, cwd: "/tmp" });
    expect(run.status).toBe("completed");
    expect(stub.seen).toEqual(["a#0", "b#0", "c#0"]);
    expect(run.executions).toHaveLength(3);
  });

  it("fans out static variants in parallel", async () => {
    const stub = new StubExecutor(new Map());
    const registry = new ExecutorRegistry();
    registry.register(stub);

    const tpl = makeTemplate([
      makeStage({
        id: "fanout",
        fanout: { kind: "static", variants: ["x", "y", "z"] },
      }),
    ]);

    const exec = new StageExecutor({ registry });
    const run = await exec.run({ runId: "r2", template: tpl, cwd: "/tmp" });
    expect(run.status).toBe("completed");
    expect(stub.seen).toEqual(["fanout#0", "fanout#1", "fanout#2"]);
  });

  it("propagates failure and marks the run as failed", async () => {
    const registry = new ExecutorRegistry();
    registry.register(new FailingExecutor("b"));

    const tpl = makeTemplate([
      makeStage({ id: "a" }),
      makeStage({ id: "b", dependsOn: ["a"] }),
      makeStage({ id: "c", dependsOn: ["b"] }),
    ]);
    const exec = new StageExecutor({ registry });
    const run = await exec.run({ runId: "r3", template: tpl, cwd: "/tmp" });
    expect(run.status).toBe("failed");
    expect(run.error?.stageId).toBe("b");
    // Stage c never runs because b failed.
    expect(run.executions.find((e) => e.stageId === "c")).toBeUndefined();
  });

  it("respects external abort signals", async () => {
    const registry = new ExecutorRegistry();
    registry.register(new HangingExecutor());
    const tpl = makeTemplate([makeStage({ id: "a" })]);
    const exec = new StageExecutor({ registry });
    const controller = new AbortController();
    const promise = exec.run({
      runId: "r4",
      template: tpl,
      cwd: "/tmp",
      abortSignal: controller.signal,
    });
    // Allow tick loop to dispatch the hanging branch.
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort("test");
    const run = await promise;
    expect(run.status).toBe("cancelled");
  });

  it("invokes lifecycle hooks", async () => {
    const onRunStart = vi.fn();
    const onRunEnd = vi.fn();
    const onStageEnd = vi.fn();
    const registry = new ExecutorRegistry();
    registry.register(new StubExecutor(new Map()));
    const tpl = makeTemplate([makeStage({ id: "a" })]);
    const exec = new StageExecutor({
      registry,
      hooks: { onRunStart, onRunEnd, onStageEnd },
    });
    await exec.run({ runId: "r5", template: tpl, cwd: "/tmp" });
    expect(onRunStart).toHaveBeenCalledTimes(1);
    expect(onStageEnd).toHaveBeenCalledTimes(1);
  });
});
