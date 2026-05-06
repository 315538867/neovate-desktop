/**
 * Agent Orchestrator — Stage plugin registry.
 *
 * Stage plugins describe per-kind defaults (label, prompt prefix,
 * recommended executor) so templates only need to opt out of the
 * defaults. Plugins are composable: they pre-process the StageNode
 * before the executor runs and post-process the StageOutput before it
 * goes to the next stage.
 *
 * The registry itself is a plain object — plugins are pure functions
 * registered at module load time.
 */

import type {
  StageKind,
  StageNode,
  StageOutput,
} from "../../../../shared/features/agent-orchestrator/types";

export type StageContext = {
  runId: string;
  branchIndex: number;
  cwd: string;
  variables: Record<string, string>;
};

export type StagePlugin = {
  kind: StageKind;
  /** Human label shown in the trace + dashboard. */
  defaultLabel: string;
  /** Optional prompt prefix prepended to the user-supplied prompt. */
  preamble?: string;
  /** Hook invoked before execution — may rewrite the stage in-place. */
  beforeExecute?(stage: StageNode, ctx: StageContext): StageNode;
  /** Hook invoked after execution — may decorate the stage output. */
  afterExecute?(stage: StageNode, output: StageOutput, ctx: StageContext): StageOutput;
};

export class StageRegistry {
  private readonly plugins = new Map<StageKind, StagePlugin>();

  register(plugin: StagePlugin): void {
    if (this.plugins.has(plugin.kind)) {
      throw new Error(`StageRegistry: duplicate plugin for kind="${plugin.kind}"`);
    }
    this.plugins.set(plugin.kind, plugin);
  }

  resolve(kind: StageKind): StagePlugin | undefined {
    return this.plugins.get(kind);
  }

  has(kind: StageKind): boolean {
    return this.plugins.has(kind);
  }

  list(): StagePlugin[] {
    return Array.from(this.plugins.values());
  }

  /** Render the prompt with the plugin's preamble (if any). */
  renderPrompt(stage: StageNode): string {
    const plugin = this.resolve(stage.kind);
    if (!plugin || !plugin.preamble) return stage.prompt;
    return `${plugin.preamble}\n\n${stage.prompt}`;
  }
}
