import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";
import { setMaintenance } from "./platform.js";
import {
  addStaffNote,
  advanceTicketInactivity,
  claimTicket,
  closeTicket,
  deliverTicketChannel,
  exportTicket,
  linkTicketReference,
  noteSystemActivity,
  openTicket,
  publishTicketPanel,
  reopenTicket,
  retainTicket,
  saveTicketSettings,
  transferTicket,
} from "./tickets.js";
import { exampleTicketSettings } from "@collective/domain";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const now = new Date("2026-10-10T01:00:00.000Z");

afterAll(async () => {
  await db.job.deleteMany({ where: { guildId } });
  await db.outboxMessage.deleteMany({ where: { guildId } });
  await db.ticketMessage.deleteMany({ where: { guildId } });
  await db.ticketReference.deleteMany({ where: { guildId } });
  await db.supportTicket.deleteMany({ where: { guildId } });
  await db.ticketPanel.deleteMany({ where: { guildId } });
  await db.ticketSettings.deleteMany({ where: { guildId } });
  await db.auditRecord.deleteMany({ where: { guildId } });
  await db.capabilityGrant.deleteMany({ where: { guildId } });
  await db.featureFlag.deleteMany({ where: { guildId } });
  await db.moderationCase.deleteMany({ where: { guildId } });
  await db.verificationRecord.deleteMany({ where: { guildId } });
  await db.roleEntitlement.deleteMany({ where: { guildId } });
  await db.guild.deleteMany({ where: { guildId } });
  await db.$disconnect();
});

describe("support tickets", () => {
  it("lets an unverified member ask for verification help without general access", async () => {
    await saveTicketSettings(db, {
      guildId,
      actorUserId: "owner",
      reason: "Publish ticket categories",
      settings: {
        ...exampleTicketSettings(),
        categories: exampleTicketSettings().categories.map((category) => ({ ...category, grantsGeneralAccess: true })),
      },
    });
    const panel = await publishTicketPanel(db, {
      guildId,
      actorUserId: "staff",
      actorRoleIds: [],
      reason: "Publish the panel",
    });
    expect(panel.result).toBe("denied");
    await db.capabilityGrant.create({ data: { id: randomUUID(), guildId, roleId: "ticket-role", capability: "tickets" } });
    const published = await publishTicketPanel(db, {
      guildId,
      actorUserId: "staff",
      actorRoleIds: ["ticket-role"],
      reason: "Publish the panel",
    });
    expect(published.result).toBe("published");
    const before = await db.supportTicket.count({ where: { guildId } });
    const empty = await openTicket(db, {
      guildId,
      userId: "new-member",
      categoryId: "verification-help",
      answers: {},
      source: "member",
      now,
    });
    expect(empty.result).toBe("invalid_form");
    expect(await db.supportTicket.count({ where: { guildId } })).toBe(before);

    const opened = await openTicket(db, {
      guildId,
      userId: "new-member",
      categoryId: "verification-help",
      answers: { need: "I cannot see the verify button" },
      source: "member",
      now,
    });
    expect(opened.result).toBe("opened");
    if (opened.result !== "opened") {
      throw new Error("Verification help did not open.");
    }
    expect(opened.grantsGeneralAccess).toBe(false);
    expect(await db.verificationRecord.findUnique({ where: { guildId_userId: { guildId, userId: "new-member" } } })).toBeNull();
    expect(await db.roleEntitlement.count({ where: { guildId, userId: "new-member" } })).toBe(0);
    const general = await openTicket(db, {
      guildId,
      userId: "new-member",
      categoryId: "general",
      answers: { topic: "Something else" },
      source: "member",
      now,
    });
    expect(general.result).toBe("verification_required");
    await setMaintenance(db, { guildId, moduleKey: "tickets", maintenance: true, actorUserId: "owner", reason: "Pause general tickets" });
    const paused = await openTicket(db, {
      guildId,
      userId: "another-member",
      categoryId: "general",
      answers: { topic: "Paused" },
      source: "member",
      now,
    });
    expect(paused.result).toBe("maintenance");
    const stillHelped = await openTicket(db, {
      guildId,
      userId: "another-member",
      categoryId: "verification-help",
      answers: { need: "Still locked out" },
      source: "member",
      now,
    });
    expect(stillHelped.result).toBe("opened");
    await setMaintenance(db, { guildId, moduleKey: "tickets", maintenance: false, actorUserId: "owner", reason: "Resume tickets" });

    await expect(
      deliverTicketChannel(db, {
        guildId,
        ticketId: opened.ticketId,
        number: opened.number,
        privacy: "thread",
        parentChannelId: null,
        openerUserId: "new-member",
        staffRoleIds: ["ticket-role"],
      }, async () => ({ outcome: "setup_required" })),
    ).rejects.toThrow(/setup_required/);
    expect((await db.supportTicket.findUnique({ where: { id: opened.ticketId } }))?.channelState).toBe("pending");
    const denied = await deliverTicketChannel(
      db,
      {
        guildId,
        ticketId: opened.ticketId,
        number: opened.number,
        privacy: "thread",
        parentChannelId: null,
        openerUserId: "new-member",
        staffRoleIds: ["ticket-role"],
      },
      async () => ({ outcome: "permission" }),
    );
    expect(denied.result).toBe("failed");
    const row = await db.supportTicket.findUnique({ where: { id: opened.ticketId } });
    expect(row?.channelState).toBe("failed");
    expect(row?.status).toBe("open");
  });

  it("keeps staff notes out of member exports and follows ownership and retention", async () => {
    await db.capabilityGrant.create({ data: { id: randomUUID(), guildId, roleId: "other-role", capability: "tickets" } });
    await db.verificationRecord.create({
      data: { id: randomUUID(), guildId, userId: "verified-member", status: "verified", verifiedAt: now },
    });
    const opened = await openTicket(db, {
      guildId,
      userId: "verified-member",
      categoryId: "general",
      answers: { topic: "Where is my role" },
      source: "member",
      now,
    });
    if (opened.result !== "opened") {
      throw new Error(`Ticket did not open: ${opened.result}.`);
    }
    expect(await claimTicket(db, { guildId, ticketId: opened.ticketId, actorUserId: "staff-a", actorRoleIds: [], reason: "Claim" })).toMatchObject({ result: "denied" });
    expect(
      await claimTicket(db, { guildId, ticketId: opened.ticketId, actorUserId: "staff-a", actorRoleIds: ["ticket-role"], reason: "Claim the ticket" }),
    ).toMatchObject({ result: "claim", openerUserId: "verified-member" });
    expect(
      await claimTicket(db, { guildId, ticketId: opened.ticketId, actorUserId: "staff-a", actorRoleIds: ["ticket-role"], reason: "Claim again" }),
    ).toMatchObject({ result: "already_claimed" });
    await addStaffNote(db, {
      guildId,
      ticketId: opened.ticketId,
      actorUserId: "staff-a",
      actorRoleIds: ["ticket-role"],
      body: "secret-staff-note",
      now,
    });
    const staffExport = await exportTicket(db, {
      guildId,
      ticketId: opened.ticketId,
      actorUserId: "staff-a",
      actorRoleIds: ["ticket-role"],
      audience: "staff",
      reason: "Review the private note",
    });
    expect(JSON.stringify(staffExport)).toContain("secret-staff-note");
    const memberExport = await exportTicket(db, {
      guildId,
      ticketId: opened.ticketId,
      actorUserId: "verified-member",
      actorRoleIds: [],
      audience: "member",
      reason: "Member copy",
    });
    expect(JSON.stringify(memberExport)).not.toContain("secret-staff-note");
    const audits = await db.auditRecord.findMany({ where: { guildId } });
    expect(audits.some((record) => record.reason.includes("secret-staff-note"))).toBe(false);

    await db.capabilityGrant.deleteMany({ where: { guildId, roleId: "ticket-role" } });
    expect(
      await addStaffNote(db, {
        guildId,
        ticketId: opened.ticketId,
        actorUserId: "staff-a",
        actorRoleIds: ["ticket-role"],
        body: "another secret",
        now,
      }),
    ).toMatchObject({ result: "denied" });
    expect(
      await exportTicket(db, {
        guildId,
        ticketId: opened.ticketId,
        actorUserId: "staff-a",
        actorRoleIds: ["ticket-role"],
        audience: "staff",
        reason: "Former staff export",
      }),
    ).toMatchObject({ result: "denied" });
    await db.capabilityGrant.create({ data: { id: randomUUID(), guildId, roleId: "ticket-role", capability: "tickets" } });

    const moved = await transferTicket(db, {
      guildId,
      ticketId: opened.ticketId,
      actorUserId: "staff-a",
      actorRoleIds: ["ticket-role"],
      targetUserId: "staff-b",
      targetRoleIds: ["other-role"],
      reason: "Hand the ticket over",
    });
    expect(moved).toMatchObject({ result: "transfer", assigneeUserId: "staff-b", openerUserId: "verified-member" });
    const blocked = await transferTicket(db, {
      guildId,
      ticketId: opened.ticketId,
      actorUserId: "staff-b",
      actorRoleIds: ["other-role"],
      targetUserId: "former",
      targetRoleIds: [],
      reason: "Give it to someone without access",
    });
    expect(blocked).toMatchObject({ result: "denied", assigneeUserId: "staff-b" });

    const firstClose = await closeTicket(db, {
      guildId,
      ticketId: opened.ticketId,
      actorUserId: "verified-member",
      actorRoleIds: [],
      reason: "Resolved",
      now,
    });
    const secondClose = await closeTicket(db, {
      guildId,
      ticketId: opened.ticketId,
      actorUserId: "verified-member",
      actorRoleIds: [],
      reason: "Resolved again",
      now: new Date(now.getTime() + 60_000),
    });
    expect(firstClose.result).toBe("closed");
    expect(secondClose.result).toBe("already_closed");
    if (firstClose.result !== "closed" || secondClose.result !== "already_closed") {
      throw new Error("Close was not idempotent.");
    }
    expect(secondClose.closedAt?.toISOString()).toBe(firstClose.closedAt.toISOString());
    expect(await reopenTicket(db, { guildId, ticketId: opened.ticketId, actorUserId: "verified-member", actorRoleIds: [], reason: "Still needed", now })).toMatchObject({ result: "reopened" });
    expect(await reopenTicket(db, { guildId, ticketId: opened.ticketId, actorUserId: "verified-member", actorRoleIds: [], reason: "Still needed", now })).toMatchObject({ result: "already_open" });
    await closeTicket(db, { guildId, ticketId: opened.ticketId, actorUserId: "staff-b", actorRoleIds: ["other-role"], reason: "Close for retention", now });
    await db.supportTicket.update({ where: { id: opened.ticketId }, data: { reopenUntil: new Date(now.getTime() - 1000) } });
    expect(await reopenTicket(db, { guildId, ticketId: opened.ticketId, actorUserId: "staff-b", actorRoleIds: ["other-role"], reason: "Too late", now })).toMatchObject({ result: "retention_elapsed" });
    expect(await retainTicket(db, opened.ticketId, now)).toMatchObject({ changed: true });
    const retained = await exportTicket(db, {
      guildId,
      ticketId: opened.ticketId,
      actorUserId: "verified-member",
      actorRoleIds: [],
      audience: "member",
      reason: "After retention",
    });
    expect(JSON.stringify(retained)).not.toContain("secret-staff-note");
    expect(JSON.stringify(retained)).not.toContain("Where is my role");
  });

  it("applies caps, records case links, and leaves purchase references unfinished", async () => {
    await db.verificationRecord.createMany({
      data: [
        { id: randomUUID(), guildId, userId: "capped-member", status: "verified", verifiedAt: now },
        { id: randomUUID(), guildId, userId: "idle-member", status: "verified", verifiedAt: now },
      ],
    });
    await saveTicketSettings(db, {
      guildId,
      actorUserId: "owner",
      reason: "Short inactivity and a one-ticket cap",
      settings: { ...exampleTicketSettings(), openCap: 1, cooldownMinutes: 60, inactivityReminderHours: 1, inactivityCloseHours: 2 },
    });
    const first = await openTicket(db, { guildId, userId: "capped-member", categoryId: "general", answers: { topic: "One" }, source: "member", now });
    const second = await openTicket(db, { guildId, userId: "capped-member", categoryId: "general", answers: { topic: "Two" }, source: "member", now });
    expect(second.result).toBe("capped");
    if (first.result !== "opened") {
      throw new Error("The first capped ticket did not open.");
    }
    await closeTicket(db, { guildId, ticketId: first.ticketId, actorUserId: "capped-member", actorRoleIds: [], reason: "Done", now });
    const cooled = await openTicket(db, {
      guildId,
      userId: "capped-member",
      categoryId: "general",
      answers: { topic: "Three" },
      source: "member",
      now: new Date(now.getTime() + 60_000),
    });
    expect(cooled.result).toBe("cooldown");

    const idle = await openTicket(db, { guildId, userId: "idle-member", categoryId: "general", answers: { topic: "Quiet" }, source: "member", now });
    if (idle.result !== "opened") {
      throw new Error("Idle ticket did not open.");
    }
    const reminded = await advanceTicketInactivity(db, idle.ticketId, new Date(now.getTime() + 90 * 60 * 1000));
    expect(reminded).toMatchObject({ action: "reminded" });
    const beforeBot = await db.supportTicket.findUnique({ where: { id: idle.ticketId } });
    await noteSystemActivity(db, idle.ticketId, new Date(now.getTime() + 100 * 60 * 1000));
    const afterBot = await db.supportTicket.findUnique({ where: { id: idle.ticketId } });
    expect(afterBot?.lastHumanAt.toISOString()).toBe(beforeBot?.lastHumanAt.toISOString());
    const closed = await advanceTicketInactivity(db, idle.ticketId, new Date(now.getTime() + 3 * 60 * 60 * 1000));
    expect(closed).toMatchObject({ action: "closed" });

    const caseId = randomUUID();
    await db.moderationCase.create({
      data: {
        id: caseId,
        guildId,
        targetUserId: "idle-member",
        actorUserId: "staff-a",
        actorKind: "staff",
        action: "warn",
        outcome: "applied",
        reason: "Linked case",
        evidence: {},
      },
    });
    const linked = await linkTicketReference(db, {
      guildId,
      ticketId: idle.ticketId,
      actorUserId: "staff-b",
      actorRoleIds: ["other-role"],
      kind: "moderation_case",
      targetId: caseId,
      reason: "Attach the sanction",
    });
    expect(linked).toMatchObject({ result: "linked", integrationStatus: "linked" });
    const purchase = await linkTicketReference(db, {
      guildId,
      ticketId: idle.ticketId,
      actorUserId: "staff-b",
      actorRoleIds: ["other-role"],
      kind: "purchase",
      targetId: "order-1",
      reason: "Record the purchase id for a later module",
    });
    expect(purchase).toMatchObject({ result: "linked", integrationStatus: "module_not_built" });
    const reward = await linkTicketReference(db, {
      guildId,
      ticketId: idle.ticketId,
      actorUserId: "staff-b",
      actorRoleIds: ["other-role"],
      kind: "reward",
      targetId: "reward-1",
      reason: "Record the reward id for a later module",
    });
    expect(reward).toMatchObject({ result: "linked", integrationStatus: "module_not_built" });
  });
});
