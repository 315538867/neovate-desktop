/**
 * Agent Orchestrator — fan-in aggregator registry.
 *
 * When a stage with `fanout` completes, its branches' outputs need to
 * be merged before downstream stages see them. The aggregation
 * strategy is selected by the consuming stage's prompt metadata or
 * the template's defaults.
 *
 * The registry ships three default strategies plus an extension hook
 * for templates that ship custom logic.
 */

import type { StageOutput } from "../../../../shared/features/agent-orchestrator/types";

export type FanInBranchInput = {
  branchIndex: number;
  output: StageOutput;
};

export type FanInAggregator = (branches: FanInBranchInput[]) => StageOutput;

const aggregators = new Map<string, FanInAggregator>();

/** Built-in: concat summaries, union changedFiles, payload becomes array. */
const concat: FanInAggregator = (branches) => {
  const summaries = branches.map((b) => b.output.summary).filter((s): s is string => Boolean(s));
  const changedFiles = unique(branches.flatMap((b) => b.output.changedFiles ?? []));
  return {
    payload: branches.map((b) => b.output.payload),
    summary: summaries.length > 0 ? summaries.join("\n\n") : undefined,
    changedFiles,
  };
};

/**
 * Built-in: pick the first branch by branchIndex. Useful for "race"
 * topology where multiple branches search the same answer and the
 * first to return wins.
 */
const firstBranch: FanInAggregator = (branches) => {
  if (branches.length === 0) {
    return { payload: undefined, changedFiles: [] };
  }
  const sorted = [...branches].sort((a, b) => a.branchIndex - b.branchIndex);
  return sorted[0]!.output;
};

/**
 * Built-in: deepest summary by character length. Heuristic for
 * "best-of-N" picks where richness correlates with quality.
 */
const longestSummary: FanInAggregator = (branches) => {
  if (branches.length === 0) {
    return { payload: undefined, changedFiles: [] };
  }
  const winner = [...branches].sort(
    (a, b) => (b.output.summary?.length ?? 0) - (a.output.summary?.length ?? 0),
  )[0]!;
  return winner.output;
};

aggregators.set("concat", concat);
aggregators.set("first", firstBranch);
aggregators.set("longest", longestSummary);

/** Pre-registration accessor for tests / templates. */
export function getAggregator(name: string): FanInAggregator | undefined {
  return aggregators.get(name);
}

export function registerAggregator(name: string, fn: FanInAggregator): void {
  if (aggregators.has(name)) {
    throw new Error(`[orchestrator] aggregator "${name}" already registered`);
  }
  aggregators.set(name, fn);
}

/** Execute aggregation by name; falls back to "concat" for unknown names. */
export function aggregate(name: string | undefined, branches: FanInBranchInput[]): StageOutput {
  const resolved = name ? aggregators.get(name) : undefined;
  const fn: FanInAggregator = resolved ?? concat;
  return fn(branches);
}

/** Test helper: clear non-default aggregators. */
export function _resetAggregatorsForTest(): void {
  aggregators.clear();
  aggregators.set("concat", concat);
  aggregators.set("first", firstBranch);
  aggregators.set("longest", longestSummary);
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items));
}
