import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    // Glob patterns match nested paths too: apps/api has its own runner, and
    // .claude/worktrees holds full repo copies (agent worktrees) that must not
    // pollute web test collection or coverage.
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "**/apps/api/**",
      "**/.claude/**",
      "**/coverage/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "coverage/web",
      // Include all source so CI diff-cover sees new lines anywhere, even untested UI.
      include: ["lib/**", "app/**", "components/**"],
      exclude: ["**/*.test.{ts,tsx}", "**/*.config.*", "test/**"],
      // Ratchet floor only — see docs/development/ci-required-checks.md (Thresholds).
      thresholds: {
        lines: 6,
        statements: 6,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `server-only` throws unless the react-server condition is set; stub it
      // so server modules can be unit-tested under the node environment.
      "server-only": path.resolve(__dirname, "test/stubs/empty.ts"),
    },
  },
});
