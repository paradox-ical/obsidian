import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";
import {
  adjustMarks,
  bulkGrantMarks,
  commitMarks,
  fundExceptional,
  holdMarks,
  issueMarks,
  listReceipts,
  readMemberWallet,
  reverseMarks,
  transferMarks,
} from "./ledger.js";
import { grantCapability, readStatistics, setMaintenance } from "./platform.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const now = new Date("2026-10-10T02:00:00.000Z");

afterAll(async () => {
  await db.ledgerEntry.deleteMany({ where: { guildId } });
  await db.wallet.deleteMany({ where: { guildId } });
  await db.issuanceBudget.deleteMany({ where: { guildId } });
  await db.economySettings.deleteMany({ where: { guildId } });
  await db.featureFlag.deleteMany({ where: { guildId } });
  await db.auditRecord.deleteMany({ where: { guildId } });
  await db.capabilityGrant.deleteMany({ where: { guildId } });
  await db.guild.deleteMany({ where: { guildId } });
  await db.$disconnect();
});

describe("marks ledger", () => {
  it("posts once, blocks a second spend, reverses, and refuses a negative balance", async () => {
    const first = await issueMarks(db, {
      guildId,
      userId: "payer",
      amountMarks: 20,
      source: "birthday",
      sourceId: "2026",
      pace: "routine",
      idempotencyKey: "birthday:payer:2026",
      reason: "birthday",
      actorUserId: "system",
      now,
    });
    const retry = await issueMarks(db, {
      guildId,
      userId: "payer",
      amountMarks: 20,
      source: "birthday",
      sourceId: "2026",
      pace: "routine",
      idempotencyKey: "birthday:payer:2026",
      reason: "birthday",
      actorUserId: "system",
      now,
    });
    expect(first.result).toBe("posted");
    expect(retry.result).toBe("already_recorded");
    expect(await readMemberWallet(db, guildId, "payer")).toMatchObject({
      privacy: "public",
      marks: { status: "available", available: "20.00", escrow: "0.00" },
      ingots: { status: "available", available: "0" },
    });

    const reversed = await reverseMarks(db, { idempotencyKey: "birthday:payer:2026", reason: "Correct the gift", actorUserId: "staff", now });
    expect(reversed.result).toBe("reversed");
    expect(await reverseMarks(db, { idempotencyKey: "birthday:payer:2026", reason: "Correct the gift", actorUserId: "staff", now })).toMatchObject({ result: "already_reversed" });
    const original = await db.ledgerEntry.findUnique({ where: { idempotencyKey: "birthday:payer:2026" } });
    expect(original?.kind).toBe("issue");
    expect(original?.amountMinor).toBe(2000n);
    expect(await readMemberWallet(db, guildId, "payer")).toMatchObject({ marks: { available: "0.00" } });

    await issueMarks(db, {
      guildId,
      userId: "payer",
      amountMarks: 10,
      source: "staff_adjustment",
      sourceId: "seed",
      pace: "routine",
      idempotencyKey: "seed:payer",
      reason: "seed",
      actorUserId: "staff",
      now,
    });
    const raced = await Promise.all([
      holdMarks(db, { guildId, userId: "payer", amountMarks: 10, idempotencyKey: "hold:a", reason: "wager", now }),
      holdMarks(db, { guildId, userId: "payer", amountMarks: 10, idempotencyKey: "hold:b", reason: "wager", now }),
    ]);
    expect(raced.map((row) => row.result).sort()).toEqual(["held", "insufficient"]);
    const wallet = await db.wallet.findUniqueOrThrow({ where: { guildId_userId_currency: { guildId, userId: "payer", currency: "marks" } } });
    expect(wallet.availableMinor).toBe(0n);
    expect(wallet.escrowMinor).toBe(1000n);
    expect(wallet.availableMinor + wallet.escrowMinor).toBe(1000n);
    expect(await commitMarks(db, { guildId, userId: "payer", amountMarks: 11, idempotencyKey: "commit:too-much", reason: "sink", now })).toMatchObject({ result: "insufficient" });
    const afterCommit = await db.wallet.findUniqueOrThrow({ where: { guildId_userId_currency: { guildId, userId: "payer", currency: "marks" } } });
    expect(afterCommit.availableMinor).toBe(0n);
    expect(afterCommit.escrowMinor).toBe(1000n);

    const beforeTransfer = await routineSpent();
    await issueMarks(db, {
      guildId,
      userId: "sender",
      amountMarks: 30,
      source: "staff_adjustment",
      sourceId: "sender",
      pace: "routine",
      idempotencyKey: "seed:sender",
      reason: "seed",
      actorUserId: "staff",
      now,
    });
    const spentAfterIssue = await routineSpent();
    expect(spentAfterIssue).toBe(beforeTransfer + 3000n);
    expect(await transferMarks(db, { guildId, fromUserId: "sender", toUserId: "friend", amountMarks: 5, idempotencyKey: "transfer:1", now })).toMatchObject({ result: "transferred" });
    expect(await routineSpent()).toBe(spentAfterIssue);
    expect(await transferMarks(db, { guildId, fromUserId: "sender", toUserId: "friend", amountMarks: 100, idempotencyKey: "transfer:too-much", now })).toMatchObject({ result: "insufficient" });
    expect(await db.ledgerEntry.count({ where: { idempotencyKey: "transfer:too-much" } })).toBe(0);

    await grantCapability(db, { guildId, roleId: "economy-role", capability: "economy_operations", actorUserId: "owner", reason: "Allow economy staff" });
    const beforeRemove = await db.ledgerEntry.count({ where: { guildId, userId: "sender" } });
    expect(await adjustMarks(db, {
      guildId,
      userId: "sender",
      action: "remove",
      amountMarks: 1000,
      reason: "Too much",
      actorUserId: "staff",
      actorRoleIds: ["economy-role"],
      idempotencyKey: "remove:too-much",
      now,
    })).toMatchObject({ result: "insufficient" });
    expect(await db.ledgerEntry.count({ where: { guildId, userId: "sender" } })).toBe(beforeRemove);
    expect(await adjustMarks(db, {
      guildId,
      userId: "sender",
      action: "remove",
      amountMarks: 1,
      reason: "A member tried this",
      actorUserId: "member",
      actorRoleIds: [],
      idempotencyKey: "remove:denied",
      now,
    })).toMatchObject({ result: "denied" });

    const capped = await issueMarks(db, {
      guildId,
      userId: "earner",
      amountMarks: 7987,
      source: "staff_adjustment",
      sourceId: "month",
      pace: "routine",
      idempotencyKey: "routine:earner",
      reason: "routine",
      actorUserId: "staff",
      now,
    });
    expect(capped.result).toBe("posted");
    expect(await issueMarks(db, {
      guildId,
      userId: "earner",
      amountMarks: 1,
      source: "achievement",
      sourceId: "extra",
      pace: "routine",
      idempotencyKey: "achievement:earner:extra",
      reason: "achievement",
      actorUserId: "system",
      now,
    })).toMatchObject({ result: "capped", scope: "member" });
    expect(await readMemberWallet(db, guildId, "earner")).toMatchObject({ marks: { available: "7987.00" } });

    const granted = await bulkGrantMarks(db, {
      guildId,
      userIds: ["one", "two"],
      amountMarks: 3,
      reason: "Event prizes",
      actorUserId: "staff",
      actorRoleIds: ["economy-role"],
      batchId: "batch-1",
      now,
    });
    expect(granted.grants.map((grant) => grant.result)).toEqual(["posted", "posted"]);
    expect(await readMemberWallet(db, guildId, "two")).toMatchObject({ marks: { available: "3.00" } });

    const memberReceipts = await listReceipts(db, { guildId, userId: "sender", audience: "member" });
    expect(memberReceipts.some((entry) => "reason" in entry)).toBe(false);
    const staffReceipts = await listReceipts(db, { guildId, userId: "sender", audience: "staff" });
    expect(staffReceipts.some((entry) => "reason" in entry && entry.reason === "seed")).toBe(true);

    expect(await readStatistics(db, { guildId, roleIds: [] })).toEqual({ status: "denied" });
    expect(await readStatistics(db, { guildId, roleIds: ["mod-role"] })).toEqual({ status: "denied" });
    await grantCapability(db, { guildId, roleId: "stats-role", capability: "statistics", actorUserId: "owner", reason: "Allow statistics" });
    expect(await readStatistics(db, { guildId, roleIds: ["stats-role"] })).toMatchObject({ status: "ready", module: "statistics" });

    const routineBeforePrize = await memberSpent("earner");
    expect(await fundExceptional(db, {
      guildId,
      amountMarks: 5000,
      idempotencyKey: "fund:lottery",
      reason: "Fund the lottery",
      actorUserId: "staff",
      actorRoleIds: ["economy-role"],
      now,
    })).toMatchObject({ result: "funded" });
    expect(await issueMarks(db, {
      guildId,
      userId: "earner",
      amountMarks: 5000,
      source: "lottery",
      sourceId: "draw-1",
      pace: "exceptional",
      idempotencyKey: "lottery:earner",
      reason: "lottery",
      actorUserId: "system",
      now,
    })).toMatchObject({ result: "posted" });
    expect(await memberSpent("earner")).toBe(routineBeforePrize);
    expect(await readMemberWallet(db, guildId, "earner")).toMatchObject({ marks: { available: "12987.00" } });
    expect(await issueMarks(db, {
      guildId,
      userId: "earner",
      amountMarks: 1,
      source: "lottery",
      sourceId: "draw-2",
      pace: "exceptional",
      idempotencyKey: "lottery:earner:2",
      reason: "lottery",
      actorUserId: "system",
      now,
    })).toMatchObject({ result: "unfunded" });

    await setMaintenance(db, { guildId, moduleKey: "economy", maintenance: true, actorUserId: "owner", reason: "Pause economy" });
    expect(await transferMarks(db, { guildId, fromUserId: "sender", toUserId: "friend", amountMarks: 1, idempotencyKey: "transfer:paused", now })).toMatchObject({ result: "maintenance" });
    await setMaintenance(db, { guildId, moduleKey: "economy", maintenance: false, actorUserId: "owner", reason: "Resume economy" });
  });
});

async function routineSpent(): Promise<bigint> {
  const row = await db.issuanceBudget.findUnique({
    where: { guildId_scope_periodKey_subjectId: { guildId, scope: "guild_routine", periodKey: "2026-10", subjectId: "guild" } },
  });
  return row?.spentMinor ?? 0n;
}

async function memberSpent(userId: string): Promise<bigint> {
  const row = await db.issuanceBudget.findUnique({
    where: { guildId_scope_periodKey_subjectId: { guildId, scope: "member_routine", periodKey: "2026-10", subjectId: userId } },
  });
  return row?.spentMinor ?? 0n;
}
