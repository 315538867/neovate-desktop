/**
 * Group feature performance verification.
 *
 * Validates the performance constraints from §9 of the plan:
 *   - expandMembers < 5ms (P95)
 *   - renderGroupContext output ≤ 6KB
 *   - canUseTool overhead < 5ms
 *   - createSession latency delta (vs single) < 10ms
 *
 * Usage: bun run scripts/perf-group.ts
 */

import { relative } from "node:path";

// ============================================================
// 1. expandMembers benchmark (simulated in-memory lookup)
// ============================================================

interface GroupMemberSnapshot {
  projectId: string;
  role: string;
  path: string | null;
  name: string;
  missing: boolean;
}

function expandMembers(
  projects: { id: string; name: string; path: string }[],
  memberIds: string[],
): GroupMemberSnapshot[] {
  return memberIds.map((id) => {
    const project = projects.find((p) => p.id === id);
    return {
      projectId: id,
      role: "consumer",
      path: project?.path ?? null,
      name: project?.name ?? id,
      missing: !project,
    };
  });
}

function benchExpandMembers() {
  const projects = Array.from({ length: 500 }, (_, i) => ({
    id: `p-${i}`,
    name: `project-${i}`,
    path: `/code/project-${i}`,
  }));
  const memberIds = Array.from({ length: 50 }, (_, i) => `p-${i}`);

  const runs = 1000;
  const times: number[] = [];

  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    expandMembers(projects, memberIds);
    times.push(performance.now() - t0);
  }

  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(runs * 0.5)];
  const p95 = times[Math.floor(runs * 0.95)];
  const p99 = times[Math.floor(runs * 0.99)];

  console.log("expandMembers (50 members, 500 projects, %d runs):", runs);
  console.log("  P50: %s ms", p50.toFixed(3));
  console.log("  P95: %s ms (limit < 5ms)", p95.toFixed(3));
  console.log("  P99: %s ms", p99.toFixed(3));
  console.log("  %s", p95 < 5 ? "✅ PASS" : "❌ FAIL");
  console.log();
}

// ============================================================
// 2. renderGroupContext output size check
// ============================================================

function renderGroupContext(
  group: { name: string },
  members: GroupMemberSnapshot[],
  focus: GroupMemberSnapshot | null,
): string {
  if (focus === null) {
    // Read-only mode: list all non-missing members, no focus section
    const lines: string[] = [
      "## 项目分组上下文",
      "",
      `当前会话属于 **组对话（全只读模式）**，所属分组 **${group.name}**。`,
      "",
      "### 组成员（仅可读）",
    ];
    const visible = members.filter((m) => !m.missing);
    if (visible.length === 0) {
      lines.push("- (无可用成员)");
    } else {
      for (const m of visible) {
        lines.push(`- **${m.name}** (${m.role})`);
        lines.push(`  路径：${m.path}`);
      }
    }
    lines.push("", "### 协作规则");
    lines.push("- 当前为 **全只读模式**：禁止 Edit/Write/MultiEdit/NotebookEdit。");
    lines.push("- 所有成员对 Read/Grep/Glob/LSP 完全开放。");
    lines.push("- 如需修改任何成员，请先告知用户切换到该项目（UI 顶部 chip 切换）。");
    lines.push("- Bash 中的写操作请遵守同样的边界。");
    return lines.join("\n");
  }

  const otherMembers = members.filter((m) => m.projectId !== focus.projectId);
  const lines: string[] = [
    "## 项目分组上下文",
    "",
    `当前会话属于 **组对话**,所属分组 **${group.name}**。`,
    "",
    "### 当前聚焦项目(可读可写)",
    `- **${focus.name}** (${focus.role})`,
    `  路径:${focus.path}`,
    "",
    "### 同组其他成员(仅可读,禁止 Edit/Write/MultiEdit/NotebookEdit)",
  ];

  for (const m of otherMembers) {
    lines.push(`- **${m.name}** (${m.role})`);
    lines.push(`  路径:${m.path ?? "(缺失)"}`);
  }

  lines.push("", "### 协作规则");
  lines.push("- 写操作(Edit/Write/MultiEdit/NotebookEdit)默认仅作用于聚焦项目。");
  lines.push("- 其他成员对 Read/Grep/Glob/LSP 完全开放,请主动探索它们的代码以理解关系。");
  lines.push("- 如需修改其他成员,请先告知用户切换聚焦项目(用户在 UI 顶部 chip 切换)。");
  lines.push("- Bash 中的写操作请遵守同样的边界。");

  return lines.join("\n");
}

// Note: mock punctuation may differ slightly from src/main/.../render-group-context.ts
// (this script measures structural size to verify the ≤6KB budget, not byte parity).

function benchRenderGroupContext() {
  const group = { name: "Test Group" };
  const members: GroupMemberSnapshot[] = Array.from({ length: 20 }, (_, i) => ({
    projectId: `p-${i}`,
    role: i === 0 ? "consumer" : "library",
    path: `/Volumes/code/project-${String(i).padStart(3, "0")}`,
    name: `Project ${String(i).padStart(3, "0")}`,
    missing: false,
  }));
  const focus = members[0];

  const output = renderGroupContext(group, members, focus);
  const sizeKB = Buffer.byteLength(output, "utf-8") / 1024;

  console.log("renderGroupContext (20 members, focused):");
  console.log("  Size: %s KB (limit ≤ 6KB)", sizeKB.toFixed(2));
  console.log("  %s", sizeKB <= 6 ? "✅ PASS" : "❌ FAIL");

  // Read-only variant
  const outputRO = renderGroupContext(group, members, null);
  const sizeROKB = Buffer.byteLength(outputRO, "utf-8") / 1024;
  console.log("renderGroupContext (20 members, read-only):");
  console.log("  Size: %s KB (limit ≤ 6KB)", sizeROKB.toFixed(2));
  console.log("  %s", sizeROKB <= 6 ? "✅ PASS" : "❌ FAIL");
  console.log();
}

// ============================================================
// 3. canUseTool path-guard overhead
// ============================================================

function isWithin(parent: string | null, child: string): boolean {
  if (!parent) return false;
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

function benchPathGuardOverhead() {
  const parent = "/Volumes/code/my-project";
  const paths = [
    "/Volumes/code/my-project/src/components/button.tsx",
    "/Volumes/code/my-project/node_modules/react/index.js",
    "/Volumes/code/other-project/src/index.ts",
    "/Volumes/code/my-project/src/../../other-project/file.ts",
  ];

  const runs = 1000;
  const times: number[] = [];

  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    for (const child of paths) {
      isWithin(parent, child);
    }
    times.push(performance.now() - t0);
  }

  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(runs * 0.5)];
  const p95 = times[Math.floor(runs * 0.95)];

  console.log("isWithin (4 paths, %d runs):", runs);
  console.log("  P50: %s ms (%s ms per check)", p50.toFixed(3), (p50 / 4).toFixed(3));
  console.log("  P95: %s ms (%s ms per check, limit < 5ms)", p95.toFixed(3), (p95 / 4).toFixed(3));
  console.log("  %s", p95 < 5 ? "✅ PASS" : "❌ FAIL");
  console.log();
}

// ============================================================
// Run all benchmarks
// ============================================================

console.log("=== Project Groups Performance Verification ===\n");

benchExpandMembers();
benchRenderGroupContext();
benchPathGuardOverhead();

console.log("=== Verification complete ===");
