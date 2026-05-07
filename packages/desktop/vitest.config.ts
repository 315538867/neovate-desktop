import { defineProject } from "vitest/config";

export default defineProject({
  define: {
    __APP_NAME__: JSON.stringify("Neovate"),
    __APP_ID__: JSON.stringify("neovate-desktop"),
    __DEEPLINK_SCHEME__: JSON.stringify("neovate"),
  },
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
    typecheck: {
      enabled: true,
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/__tests__/**",
        "src/**/*.d.ts",
        "src/preload/**",
        "src/**/types.ts",
        "src/**/contract.ts",
        "src/**/schemas.ts",
      ],
      // Regression-only floor. Current measured baseline (~23% lines /
      // ~18% branches) — thresholds are pinned a hair below current to
      // catch regressions without producing noise. The aspirational
      // target is 60% lines/branches; raise these as new tests land.
      thresholds: {
        lines: 20,
        branches: 15,
        functions: 15,
        statements: 20,
      },
    },
  },
});
