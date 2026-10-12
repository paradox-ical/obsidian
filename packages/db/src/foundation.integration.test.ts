import { FOUNDATION_REVISION } from "@collective/domain";
import { afterAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";
import { readFoundationRevision } from "./foundation.js";

const databaseUrl = process.env["DATABASE_URL"];

if (!databaseUrl) {
  throw new Error(
    "test:integration requires DATABASE_URL. Copy .env.example to .env and start PostgreSQL with docker compose up -d postgres.",
  );
}

describe("foundation migration", () => {
  const prisma = createPrismaClient(databaseUrl);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("reads the phase 0A revision from PostgreSQL", async () => {
    await expect(readFoundationRevision(prisma)).resolves.toBe(FOUNDATION_REVISION);
  });
});
