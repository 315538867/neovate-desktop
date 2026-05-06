/**
 * Agent Orchestrator — fan-out expander.
 *
 * Given a stage's `fanout` spec and the resolved upstream outputs,
 * compute the list of branches to dispatch. Each branch carries its
 * own `branchIndex` (used for state-row keying) and an extra `vars`
 * map that the prompt template will interpolate.
 *
 * Two flavours:
 *   • static  — `variants: ["a", "b", "c"]` → one branch per literal,
 *               variable is exposed as `_variant`
 *   • input   — read a `payload[path]` array from the upstream stage
 *               output and emit one branch per element. The element
 *               itself is exposed via `_input`; if it is an object,
 *               its top-level keys are also splatted into vars.
 */

import type {
  FanoutSpec,
  StageNode,
  StageOutput,
} from "../../../../shared/features/agent-orchestrator/types";

export type FanoutBranch = {
  branchIndex: number;
  /** Extra variables merged into the stage's prompt context. */
  vars: Record<string, string>;
  /** Raw value driving the branch — useful for debug / trace events. */
  source: unknown;
};

export type FanoutResolveContext = {
  /**
   * Outputs of upstream stages, keyed by `${stageId}#${branchIndex}`.
   * The expander walks `stageId` only — fan-in over multiple branches
   * is handled by the fan-in aggregator before it reaches us.
   */
  upstreamOutputs: ReadonlyMap<string, StageOutput>;
  /**
   * Fallback stage id to read from when the spec doesn't name one
   * explicitly. The orchestrator passes the most recent dependency.
   */
  defaultSourceStageId?: string;
};

/**
 * Expand a stage into its branch list. A stage without a `fanout`
 * spec yields a single branch with index 0 and no extra vars.
 */
export function expandFanout(stage: StageNode, ctx: FanoutResolveContext): FanoutBranch[] {
  if (!stage.fanout) {
    return [{ branchIndex: 0, vars: {}, source: undefined }];
  }
  return expandFanoutSpec(stage.fanout, ctx);
}

export function expandFanoutSpec(spec: FanoutSpec, ctx: FanoutResolveContext): FanoutBranch[] {
  if (spec.kind === "static") {
    return spec.variants.map((variant, idx) => ({
      branchIndex: idx,
      vars: { _variant: variant },
      source: variant,
    }));
  }
  // kind === "input"
  const stageId = ctx.defaultSourceStageId;
  if (!stageId) {
    throw new Error(
      "[orchestrator] fanout kind=input requires defaultSourceStageId in resolution context",
    );
  }
  const output = findUpstreamOutput(ctx.upstreamOutputs, stageId);
  if (!output) {
    throw new Error(`[orchestrator] fanout source stage "${stageId}" produced no output to expand`);
  }
  const arr = readDotPath(output.payload, spec.path);
  if (!Array.isArray(arr)) {
    throw new Error(
      `[orchestrator] fanout path "${spec.path}" did not resolve to an array (got ${typeof arr})`,
    );
  }
  if (arr.length === 0) return [];
  const max = spec.maxBranches;
  const items = arr.length > max ? arr.slice(0, max) : arr;
  return items.map((item, idx) => ({
    branchIndex: idx,
    vars: makeInputVars(item),
    source: item,
  }));
}

function findUpstreamOutput(
  outputs: ReadonlyMap<string, StageOutput>,
  stageId: string,
): StageOutput | undefined {
  // Prefer the canonical branchIndex=0 row (single-branch upstream).
  const direct = outputs.get(`${stageId}#0`);
  if (direct) return direct;
  // Fall back to first matching branch (fan-out → fan-out chains).
  for (const [key, output] of outputs) {
    if (key.startsWith(`${stageId}#`)) return output;
  }
  return undefined;
}

function readDotPath(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const seg of path.split(".")) {
    if (!seg) continue;
    if (cur == null) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function makeInputVars(item: unknown): Record<string, string> {
  const vars: Record<string, string> = { _input: String(item) };
  if (item && typeof item === "object" && !Array.isArray(item)) {
    for (const [k, v] of Object.entries(item)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        vars[k] = String(v);
      }
    }
  }
  return vars;
}
