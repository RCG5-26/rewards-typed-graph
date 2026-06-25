import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "coverage/api",
      include: ["src/**"],
      exclude: ["**/*.test.ts", "tests/**"],
      // Ratchet floor only — see docs/development/ci-required-checks.md (Thresholds).
      thresholds: {
        lines: 65,
        statements: 65,
        functions: 88,
        branches: 76,
      },
    },
  },
});
