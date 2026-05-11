/**
 * Contract shape guard — Wave 3.1.
 *
 * Locks in the `agent.session.*` / `agent.orchestrator.*` split so an
 * accidental flatten or rename trips a CI failure rather than leaking
 * into the renderer codemod surface. The leaf counts are deliberate
 * tripwires; bump them in the same PR that adds/removes a leaf.
 */

import { describe, expect, it } from "vitest";

import { contract } from "../contract";
import { orchestratorContract } from "../features/agent-orchestrator/contract";
import { sessionContract } from "../features/agent/contract";

describe("contract shape (Wave 3.1)", () => {
  it("exposes agent.session and agent.orchestrator under the agent namespace", () => {
    expect(contract.agent).toBeDefined();
    expect(contract.agent.session).toBe(sessionContract);
    expect(contract.agent.orchestrator).toBe(orchestratorContract);
  });

  it("does not retain the legacy flat agent.* leaves", () => {
    const agentEntry = contract.agent as Record<string, unknown>;
    // Flat leaves used to live here pre-3.1; the codemod must remove them.
    expect("activeSessions" in agentEntry).toBe(false);
    expect("forkSession" in agentEntry).toBe(false);
    expect("rewindToMessage" in agentEntry).toBe(false);
    expect("savePlan" in agentEntry).toBe(false);
    expect("setModelSetting" in agentEntry).toBe(false);
    expect("listSessions" in agentEntry).toBe(false);
    expect("renameSession" in agentEntry).toBe(false);
    expect("subscribeSessionLifecycle" in agentEntry).toBe(false);
    expect("claudeCode" in agentEntry).toBe(false);
    expect("network" in agentEntry).toBe(false);
  });

  it("session contract exposes the expected leaf groups", () => {
    // Top-level leaves (12)
    expect(sessionContract.activeSessions).toBeDefined();
    expect(sessionContract.subscribeSessionLifecycle).toBeDefined();
    expect(sessionContract.listSessions).toBeDefined();
    expect(sessionContract.renameSession).toBeDefined();
    expect(sessionContract.updateSessionStartTime).toBeDefined();
    expect(sessionContract.forkSession).toBeDefined();
    expect(sessionContract.rewindFilesDryRun).toBeDefined();
    expect(sessionContract.rewindToMessage).toBeDefined();
    expect(sessionContract.deleteSessionFile).toBeDefined();
    expect(sessionContract.archiveSessionFile).toBeDefined();
    expect(sessionContract.savePlan).toBeDefined();
    expect(sessionContract.setModelSetting).toBeDefined();

    // claudeCode.* (6 leaves)
    expect(sessionContract.claudeCode.createSession).toBeDefined();
    expect(sessionContract.claudeCode.send).toBeDefined();
    expect(sessionContract.claudeCode.subscribe).toBeDefined();
    expect(sessionContract.claudeCode.dispatch).toBeDefined();
    expect(sessionContract.claudeCode.closeSession).toBeDefined();
    expect(sessionContract.claudeCode.loadSession).toBeDefined();

    // network.* (5 leaves)
    expect(sessionContract.network.listRequests).toBeDefined();
    expect(sessionContract.network.getRequestDetail).toBeDefined();
    expect(sessionContract.network.getInspectorState).toBeDefined();
    expect(sessionContract.network.clearRequests).toBeDefined();
    expect(sessionContract.network.subscribe).toBeDefined();
  });

  it("orchestrator contract exposes the expected leaves", () => {
    const expected = [
      "listTemplates",
      "startRun",
      "getRun",
      "listRuns",
      "cancelRun",
      "listRecoverableRuns",
      "resumeRunWithStrategy",
      "approveGate",
      "subscribeRun",
      "subscribeAll",
      "listCheckpoints",
    ] as const;
    for (const leaf of expected) {
      expect(orchestratorContract).toHaveProperty(leaf);
    }
    // Tripwire — bump alongside the contract when adding leaves.
    expect(Object.keys(orchestratorContract).sort()).toEqual([...expected].sort());
  });

  it("session contract surface is exactly the legacy 23+1-leaf count", () => {
    const top = Object.keys(sessionContract).length;
    const claudeCodeLeaves = Object.keys(sessionContract.claudeCode).length;
    const networkLeaves = Object.keys(sessionContract.network).length;
    // 12 top-level + 1 (setFocusProject) + 6 + 5 - 2 group keys = 22 + 1 + 6 + 5 - 2 = 24
    expect(top + claudeCodeLeaves + networkLeaves - /* group keys counted twice */ 2).toBe(24);
  });
});
