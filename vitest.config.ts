import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const domainEntry = fileURLToPath(new URL("./packages/domain/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@collective/domain": domainEntry,
    },
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/*.integration.test.ts", "**/dist/**", "**/node_modules/**"],
  },
});
