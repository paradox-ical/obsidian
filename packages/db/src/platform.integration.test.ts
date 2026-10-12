import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";
import {
  activeConfig,
  enqueueJob,
  enqueueOutbox,
  claimJob,
  ensureGuild,
  executeSession,
  listDeadJobs,
  moduleIsAvailable,
  openSession,
  publishDraft,
  readStatistics,
  routeInteraction,
  saveDraft,
  setMaintenance,
  writeAudit,
} from "./platform.js";
import { runJobOnce, runOutboxOnce } from "./worker.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const keys: string[] = [];

function key(name: string): string {
  const value = `test-${name}-${randomUUID()}`;
  keys.push(value);
  return value;
}

afterAll(async () => {
  await db.job.deleteMany({ where: { idempotencyKey: { in: keys } } });
  await db.outboxMessage.deleteMany({ where: { idempotencyKey: { in: keys } } });
  await db.interactionSession.deleteMany({ where: { guildId } });
  await db.auditRecord.deleteMany({ where: { guildId } });
  await db.featureFlag.deleteMany({ where: { guildId } });
  await db.capabilityGrant.deleteMany({ where: { guildId } });
  await db.configVersion.deleteMany({ where: { guildId } });
  await db.guild.deleteMany({ where: { guildId } });
  await db.$disconnect();
});

describe("durable jobs and outbox", () => {
  it("returns the existing job when the same work is enqueued twice", async () => {
    const idempotencyKey = key("duplicate");
    const [first, second] = await Promise.all([
      enqueueJob(db, { guildId, jobType: "ping", payload: { n: 1 }, idempotencyKey }),
      enqueueJob(db, { guildId, jobType: "ping", payload: { n: 1 }, idempotencyKey }),
    ]);
    expect(first.job.id).toBe(second.job.id);
    expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
    expect(await db.job.count({ where: { idempotencyKey } })).toBe(1);
    await db.job.update({ where: { idempotencyKey }, data: { status: "succeeded" } });
  });

  it("reclaims a job whose lease expired and then dead-letters an unknown type", async () => {
    const idempotencyKey = key("restart");
    await enqueueJob(db, { guildId, jobType: "ping", payload: {}, idempotencyKey, maxAttempts: 2 });
    const now = new Date();
    const first = await claimJob(db, "worker-a", now, 30_000);
    expect(first?.idempotencyKey).toBe(idempotencyKey);
    if (!first) {
      throw new Error("The restart job was not claimed.");
    }
    await db.job.update({
      where: { id: first.id },
      data: { leaseUntil: new Date(now.getTime() - 1_000) },
    });
    let secondAttempt = 0;
    const recovered = await runJobOnce(
      db,
      new Map([
        [
          "ping",
          async (work) => {
            secondAttempt = work.attempts;
          },
        ],
      ]),
      { owner: "worker-b", now: new Date(), leaseMs: 30_000 },
    );
    expect(recovered).toMatchObject({ claimed: true, outcome: "succeeded" });
    expect(secondAttempt).toBe(2);

    const deadKey = key("dead");
    await enqueueJob(db, { guildId, jobType: "missing", payload: { secret: "do-not-list" }, idempotencyKey: deadKey, maxAttempts: 1 });
    const dead = await runJobOnce(db, new Map(), { owner: "worker-c", now: new Date(), leaseMs: 1_000, delayMs: () => 0 });
    expect(dead).toMatchObject({ claimed: true, outcome: "dead" });
    const listed = await listDeadJobs(db, guildId);
    const row = listed.find((job) => job.jobType === "missing");
    expect(row?.lastError).toMatch(/No handler/);
    expect(row).not.toHaveProperty("payload");
    expect(JSON.stringify(listed)).not.toContain("do-not-list");
  });

  it("rolls back a job and outbox write together, then retries outbox delivery", async () => {
    const jobKey = key("rollback-job");
    const outboxKey = key("rollback-outbox");
    await expect(
      db.$transaction(async (tx) => {
        await enqueueJob(tx, { guildId, jobType: "ping", payload: {}, idempotencyKey: jobKey });
        await enqueueOutbox(tx, { guildId, eventType: "notice", payload: {}, idempotencyKey: outboxKey });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await db.job.findUnique({ where: { idempotencyKey: jobKey } })).toBeNull();
    expect(await db.outboxMessage.findUnique({ where: { idempotencyKey: outboxKey } })).toBeNull();

    const deliveryKey = key("delivery");
    await enqueueOutbox(db, { guildId, eventType: "notice", payload: { n: 1 }, idempotencyKey: deliveryKey, maxAttempts: 3 });
    let calls = 0;
    const handlers = new Map([
      [
        "notice",
        async () => {
          calls += 1;
          if (calls === 1) {
            throw new Error("discord unavailable");
          }
        },
      ],
    ]);
    const options = { owner: "outbox", now: new Date(), leaseMs: 1_000, delayMs: () => 0 };
    expect(await runOutboxOnce(db, handlers, options)).toMatchObject({ claimed: true, outcome: "retry" });
    expect(await runOutboxOnce(db, handlers, options)).toMatchObject({ claimed: true, outcome: "delivered" });
    expect(await runOutboxOnce(db, handlers, options)).toMatchObject({ claimed: false });
    expect(calls).toBe(2);
    const delivered = await db.outboxMessage.findUniqueOrThrow({ where: { idempotencyKey: deliveryKey } });
    expect(delivered.status).toBe("delivered");
    expect(delivered.deliveredAt).not.toBeNull();
  });
});

describe("sessions, configuration, and statistics access", () => {
  it("keeps drafts inactive, protects verification, and rejects a stale component", async () => {
    await ensureGuild(db, { guildId, ownerUserId: "owner" });
    const draft = await saveDraft(db, {
      guildId,
      document: { name: "draft" },
      actorUserId: "owner",
      reason: "Prepare the first draft",
    });
    expect(await activeConfig(db, guildId)).toBeNull();
    await publishDraft(db, { guildId, draftId: draft.id, actorUserId: "owner", reason: "Publish the first draft" });
    await expect(writeAudit(db, {
      guildId,
      actorUserId: "owner",
      action: "note",
      targetType: "guild",
      targetId: guildId,
      reason: "   ",
    })).rejects.toThrow(/reason/);
    await expect(
      setMaintenance(db, {
        guildId,
        moduleKey: "verification",
        maintenance: true,
        actorUserId: "owner",
        reason: "Try to pause verification",
      }),
    ).rejects.toThrow(/moderation/);
    await setMaintenance(db, {
      guildId,
      moduleKey: "economy",
      maintenance: true,
      actorUserId: "owner",
      reason: "Pause the economy",
    });
    expect(await moduleIsAvailable(db, guildId, "verification")).toBe(true);
    expect(await moduleIsAvailable(db, guildId, "moderation")).toBe(true);
    expect(await moduleIsAvailable(db, guildId, "economy")).toBe(false);

    const actor = "staff-user";
    const session = await openSession(db, {
      guildId,
      actorUserId: actor,
      purpose: "stats",
      payload: {},
      requiredCapability: "statistics",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const replacement = await saveDraft(db, {
      guildId,
      document: { name: "replacement" },
      actorUserId: "owner",
      reason: "Replace the published configuration",
    });
    await publishDraft(db, {
      guildId,
      draftId: replacement.id,
      actorUserId: "owner",
      reason: "Publish the replacement",
    });
    const stale = await executeSession(db, {
      sessionId: session.id,
      actorUserId: actor,
      roleIds: ["stats-role"],
      now: new Date(),
    });
    expect(stale).toMatchObject({ ok: false, reason: "stale" });
    const stored = await db.interactionSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(stored.consumedAt).toBeNull();

    const memberSession = await openSession(db, {
      guildId,
      actorUserId: "member",
      purpose: "stats",
      payload: {},
      requiredCapability: "statistics",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const denied = await routeInteraction(db, {
      customId: `session:${memberSession.id}`,
      actorUserId: "member",
      roleIds: [],
      now: new Date(),
    });
    expect(denied).toMatchObject({ handled: true, access: "denied" });
    expect(await readStatistics(db, { guildId, roleIds: [] })).toEqual({ status: "denied" });
    expect(await readStatistics(db, { guildId, roleIds: ["mod-role"] })).toEqual({ status: "denied" });
  });
});
