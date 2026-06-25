import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", "apps/api", ".next"],
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
