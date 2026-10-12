import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";
import { defineConfig } from "vitest/config";

const envPath = fileURLToPath(new URL("./.env", import.meta.url));
if (existsSync(envPath)) {
  loadDotenv({ path: envPath });
}

const domainEntry = fileURLToPath(new URL("./packages/domain/src/index.ts", import.meta.url));
const dbEntry = fileURLToPath(new URL("./packages/db/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@collective/domain": domainEntry,
      "@collective/db": dbEntry,
    },
  },
  test: {
    environment: "node",
    include: ["packages/**/*.integration.test.ts", "apps/**/*.integration.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
