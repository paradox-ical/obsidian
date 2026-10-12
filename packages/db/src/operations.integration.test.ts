import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";
import {
  activeConfig,
  changeOperationsMaintenance,
  exportOperationsConfig,
  importOperationsDraft,
  moduleIsAvailable,
  previewOperationsImport,
  publishOperationsDraft,
  readOperations,
  recordOperationsAlert,
  rollbackOperationsConfig,
} from "./index.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const now = new Date("2026-10-12T08:00:00.000Z");

afterAll(async () => {
  await db.job.deleteMany({ where: { guildId } });
  await db.auditRecord.deleteMany({ where: { guildId } });
  await db.featureFlag.deleteMany({ where: { guildId } });
  await db.configVersion.deleteMany({ where: { guildId } });
  await db.guild.deleteMany({ where: { guildId } });
  await db.$disconnect();
});

describe("operations configuration", () => {
  it("keeps drafts inactive, rolls back by copying a version, and redacts a dead job", async () => {
    const preview = previewOperationsImport({ label: "First", url: "http://127.0.0.1/private" });
    expect(preview.ok).toBe(false);
    expect(await db.configVersion.count({ where: { guildId } })).toBe(0);

    const rejected = await importOperationsDraft(db, { guildId, document: { token: "hidden" }, actorUserId: "admin", reason: "Reject a secret" });
    expect(rejected.result).toBe("invalid");

    const first = await importOperationsDraft(db, { guildId, document: { label: "First hall" }, actorUserId: "admin", reason: "Save the first draft" });
    expect(first).toMatchObject({ result: "draft", state: "draft", active: false });
    if (first.result !== "draft") {
      return;
    }
    const published = await publishOperationsDraft(db, { guildId, draftId: first.draftId, actorUserId: "admin", reason: "Publish the first hall" });
    expect(published).toMatchObject({ result: "published", active: true });

    const second = await importOperationsDraft(db, { guildId, document: { label: "Second hall" }, actorUserId: "admin", reason: "Save a later draft" });
    if (second.result !== "draft") {
      throw new Error("second draft was not saved");
    }
    await publishOperationsDraft(db, { guildId, draftId: second.draftId, actorUserId: "admin", reason: "Publish the second hall" });
    const prepared = await rollbackOperationsConfig(db, { guildId, version: 1, actorUserId: "admin", reason: "Prepare the earlier hall", confirm: false });
    expect(prepared).toMatchObject({ result: "draft", active: false });
    expect((await activeConfig(db, guildId))?.version).toBe(2);

    const restored = await rollbackOperationsConfig(db, { guildId, version: 1, actorUserId: "admin", reason: "Restore the earlier hall", confirm: true });
    expect(restored).toMatchObject({ result: "published", replacedVersion: 1 });
    const exported = await exportOperationsConfig(db, guildId);
    expect(exported).toMatchObject({ stored: true, state: "published", secrets: "omitted", document: { label: "First hall" } });
    expect(await db.configVersion.count({ where: { guildId, version: 1 } })).toBe(1);

    expect(await changeOperationsMaintenance(db, { guildId, moduleKey: "verification", maintenance: true, actorUserId: "admin", reason: "Pause verification" })).toMatchObject({ result: "protected", available: true });
    expect(await moduleIsAvailable(db, guildId, "verification")).toBe(true);
    expect(await changeOperationsMaintenance(db, { guildId, moduleKey: "economy", maintenance: true, actorUserId: "admin", reason: "Pause the economy" })).toMatchObject({ result: "saved", maintenance: true });
    expect(await moduleIsAvailable(db, guildId, "economy")).toBe(false);
    expect(await moduleIsAvailable(db, guildId, "moderation")).toBe(true);

    await db.job.create({
      data: {
        id: randomUUID(),
        guildId,
        jobType: "ping",
        payload: { token: "do-not-show" },
        idempotencyKey: `dead-${randomUUID()}`,
        status: "dead",
        runAt: now,
        maxAttempts: 1,
        lastError: "delivery token=abc123",
      },
    });
    const view = await readOperations(db, guildId, now);
    expect(view.draftsAreActive).toBe(false);
    expect(view.jobs[0]?.lastError).toBe("delivery token=[redacted]");
    expect(JSON.stringify(view.jobs)).not.toContain("do-not-show");
    expect(view.health.alerts).toContain("dead_jobs");
    expect(view.simulations.persisted).toBe(false);
    expect(view.simulations.grants).toBe("none");
    expect(view.health.ticketRetentionDays).toBe(14);
    expect(view.health.warningRetentionDays).toBe(14);
    const recorded = await recordOperationsAlert(db, { guildId, actorUserId: "admin", reason: "Dead job needs staff", now });
    expect(recorded).toMatchObject({ result: "recorded", posted: "not_posted" });
  });
});
