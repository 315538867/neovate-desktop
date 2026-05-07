#!/usr/bin/env bun
import { $ } from "bun";
import { execSync } from "child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

async function main() {
  const args = process.argv.slice(2);
  const shouldBuild = args.includes("--build");
  const shouldRunE2E = args.includes("--e2e");
  const shouldRunCoverage = args.includes("--coverage");

  console.log("🚀 Starting ready check...\n");

  // Step 1: Run format and check for git changes
  console.log("🎨 Running formatter...");
  try {
    await $`bun run format`.quiet();

    const gitStatus = execSync("git diff --name-only", { encoding: "utf-8" });
    if (gitStatus.trim()) {
      console.error("❌ Format check failed: There are unstaged changes after formatting");
      console.error("Changed files:");
      console.error(gitStatus);
      process.exit(1);
    }
    console.log("✅ Format check passed\n");
  } catch (error) {
    console.error("❌ Format check failed:", error);
    process.exit(1);
  }

  // Step 2: Run typecheck + lint + lint:format
  console.log("🔍 Running check...");
  try {
    await $`bun run check`.quiet();
    console.log("✅ Check passed\n");
  } catch (error) {
    console.error("❌ Check failed:", error);
    process.exit(1);
  }

  // Step 3: Build (only if --build flag is provided)
  if (shouldBuild) {
    console.log("📦 Building project...");
    try {
      await $`bun run build`.quiet();
      console.log("✅ Build completed successfully\n");
    } catch (error) {
      console.error("❌ Build failed:", error);
      process.exit(1);
    }
  }

  // Step 4: Run tests
  console.log("🧪 Running tests...");
  try {
    await $`bun run test:run`.quiet();
    console.log("✅ Tests passed\n");
  } catch (error) {
    console.error("❌ Tests failed:", error);
    process.exit(1);
  }

  // Step 5: Coverage gate (only if --coverage flag is provided)
  // The gate enforces a regression floor via vitest's `thresholds`;
  // this step also reports the actual % so we can see whether we're
  // approaching the 60% aspirational target.
  if (shouldRunCoverage) {
    console.log("📊 Running coverage check...");
    try {
      await $`bun run test:coverage`.quiet();
      const summaryPath = path.resolve(
        process.cwd(),
        "packages/desktop/coverage/coverage-summary.json",
      );
      try {
        const raw = readFileSync(summaryPath, "utf-8");
        const summary = JSON.parse(raw) as {
          total: {
            lines: { pct: number };
            branches: { pct: number };
            functions: { pct: number };
            statements: { pct: number };
          };
        };
        const t = summary.total;
        console.log(
          `   lines ${t.lines.pct.toFixed(1)}% · branches ${t.branches.pct.toFixed(1)}% · ` +
            `functions ${t.functions.pct.toFixed(1)}% · statements ${t.statements.pct.toFixed(1)}%`,
        );
      } catch {
        // coverage-summary.json missing — non-fatal, vitest already enforced thresholds
      }
      console.log("✅ Coverage check passed\n");
    } catch (error) {
      console.error("❌ Coverage check failed:", error);
      process.exit(1);
    }
  }

  // Step 6: Run e2e tests (only if --e2e flag is provided)
  if (shouldRunE2E) {
    console.log("🎭 Running e2e tests...");
    try {
      await $`bun run test:e2e`.quiet();
      console.log("✅ E2E tests passed\n");
    } catch (error) {
      console.error("❌ E2E tests failed:", error);
      process.exit(1);
    }
  }

  console.log("🎉 All checks passed! Project is ready.");
}

main().catch((error) => {
  console.error("❌ Unexpected error:", error);
  process.exit(1);
});
