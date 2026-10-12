import { randomUUID } from "node:crypto";

import { examplePolicy } from "@collective/domain";
import { afterAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";
import {
  deliverModeration,
  expireWarning,
  exportLogs,
  ingestMessage,
  manualSanction,
  readModerationPolicy,
  recordStaffLog,
  resolveAppeal,
  retainLog,
  reverseCase,
  saveModerationPolicy,
  searchLogs,
  submitAppeal,
  submitReport,
  warningTotal,
} from "./moderation.js";
import { readStatistics } from "./platform.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const now = new Date("2026-10-07T03:00:00.000Z");
const manageMessages = String(1n << 13n);

afterAll(async () => {
  await db.job.deleteMany({ where: { guildId } });
  await db.outboxMessage.deleteMany({ where: { guildId } });
  await db.ticketMessage.deleteMany({ where: { guildId } });
  await db.ticketReference.deleteMany({ where: { guildId } });
  await db.supportTicket.deleteMany({ where: { guildId } });
  await db.ticketPanel.deleteMany({ where: { guildId } });
  await db.ticketSettings.deleteMany({ where: { guildId } });
  await db.warningPoint.deleteMany({ where: { guildId } });
  await db.moderationAppeal.deleteMany({ where: { guildId } });
  await db.memberReport.deleteMany({ where: { guildId } });
  await db.staffLog.deleteMany({ where: { guildId } });
  await db.moderationSignal.deleteMany({ where: { guildId } });
  await db.moderationCase.deleteMany({ where: { guildId } });
  await db.moderationPolicy.deleteMany({ where: { guildId } });
  await db.auditRecord.deleteMany({ where: { guildId } });
  await db.capabilityGrant.deleteMany({ where: { guildId } });
  await db.$disconnect();
});

describe("moderation cases, warnings, and staff logs", () => {
  it("keeps ban off heuristic matches and records deletion and hierarchy failures", async () => {
    await db.capabilityGrant.create({
      data: { id: randomUUID(), guildId, roleId: "mod-role", capability: "moderation" },
    });
    const saved = await saveModerationPolicy(db, {
      guildId,
      actorUserId: "owner",
      reason: "Publish the example with a ban action that must be removed",
      policy: {
        ...examplePolicy(),
        rules: examplePolicy().rules.map((rule) =>
          rule.id === "example-repeat" ? { ...rule, actions: ["ban", "delete", "warn"] } : rule,
        ),
      },
    });
    expect(saved.banRemoved).toBe(true);
    expect(saved.policy.rules.every((rule) => !rule.actions.includes("ban"))).toBe(true);
    const stored = await readModerationPolicy(db, guildId);
    expect(stored.policy.rules.every((rule) => !rule.actions.includes("ban"))).toBe(true);

    const common = {
      guildId,
      userId: "member-1",
      channelId: "general",
      content: "hello again",
      mentionCount: 0,
      roleIds: [] as string[],
      targetPosition: 1,
      botPosition: 10,
      botPermissions: manageMessages,
      targetIsOwner: false,
      messageId: "message-1",
    };
    await ingestMessage(db, { ...common, now });
    await ingestMessage(db, { ...common, now: new Date(now.getTime() + 1000) });
    const third = await ingestMessage(db, { ...common, now: new Date(now.getTime() + 2000) });
    expect(third.banApplied).toBe(false);
    expect(third.actions).not.toContain("ban");
    expect(third.actions).toContain("delete");
    const deleteCase = await db.moderationCase.findFirstOrThrow({
      where: { guildId, action: "delete", outcome: "pending" },
    });
    const delivered = await deliverModeration(
      db,
      {
        caseId: deleteCase.id,
        guildId,
        action: "delete",
        targetUserId: "member-1",
        channelId: "general",
        messageId: "message-1",
      },
      async () => "missing_message",
    );
    expect(delivered).toMatchObject({ outcome: "failed", reason: "missing_message" });
    expect(await db.moderationCase.findUnique({ where: { id: deleteCase.id } })).toMatchObject({
      outcome: "failed",
      failureReason: "missing_message",
    });

    const hierarchy = await manualSanction(db, {
      guildId,
      actorUserId: "mod",
      actorRoleIds: ["mod-role"],
      targetUserId: "member-1",
      action: "timeout",
      reason: "Try a timeout above the bot",
      points: 0,
      days: 1,
      actorPosition: 2,
      targetPosition: 8,
      botPosition: 3,
      botPermissions: String(1n << 40n),
      targetIsOwner: false,
      now,
    });
    expect(hierarchy).toMatchObject({ result: "failed", reason: "hierarchy" });
    expect(await searchLogs(db, { guildId, actorRoleIds: [], query: "" })).toMatchObject({ result: "denied" });
    expect(await exportLogs(db, { guildId, actorUserId: "member", actorRoleIds: [], reason: "no" })).toMatchObject({
      result: "denied",
    });
    expect(await readStatistics(db, { guildId, roleIds: [] })).toMatchObject({ status: "denied" });
  });

  it("expires and reverses warning points without dropping the history", async () => {
    const first = await manualSanction(db, {
      guildId,
      actorUserId: "mod",
      actorRoleIds: ["mod-role"],
      targetUserId: "member-2",
      action: "warn",
      reason: "First warning",
      points: 2,
      days: 7,
      actorPosition: 10,
      targetPosition: 1,
      botPosition: 12,
      botPermissions: "0",
      targetIsOwner: false,
      now,
    });
    const second = await manualSanction(db, {
      guildId,
      actorUserId: "mod",
      actorRoleIds: ["mod-role"],
      targetUserId: "member-2",
      action: "warn",
      reason: "Second warning",
      points: 4,
      days: 7,
      actorPosition: 10,
      targetPosition: 1,
      botPosition: 12,
      botPermissions: "0",
      targetIsOwner: false,
      now: new Date(now.getTime() + 1000),
    });
    expect(await warningTotal(db, guildId, "member-2", now)).toBe(6);
    if (first.result !== "recorded" || second.result !== "recorded") {
      throw new Error("Warnings were not recorded.");
    }
    const warning = await db.warningPoint.findFirstOrThrow({ where: { guildId, caseId: first.caseId } });
    await db.warningPoint.update({ where: { id: warning.id }, data: { expiresAt: new Date(now.getTime() - 1000) } });
    expect(await expireWarning(db, warning.id, now)).toMatchObject({ changed: true });
    expect(await warningTotal(db, guildId, "member-2", now)).toBe(4);
    expect(await db.warningPoint.findUnique({ where: { id: warning.id } })).toMatchObject({ status: "expired" });
    expect(
      await reverseCase(db, {
        guildId,
        actorUserId: "mod",
        actorRoleIds: ["mod-role"],
        caseId: second.caseId,
        reason: "Overturned on review",
        now,
      }),
    ).toMatchObject({ result: "reversed" });
    expect(await warningTotal(db, guildId, "member-2", now)).toBe(0);
    expect(await db.warningPoint.count({ where: { guildId, userId: "member-2" } })).toBe(2);

    const appeal = await submitAppeal(db, { guildId, userId: "member-2", caseId: first.caseId, note: "Please review" });
    expect(appeal.result).toBe("submitted");
    if (appeal.result !== "submitted") {
      throw new Error("Appeal was not submitted.");
    }
    expect(
      await resolveAppeal(db, {
        guildId,
        actorUserId: "mod",
        actorRoleIds: ["mod-role"],
        appealId: appeal.appealId,
        accept: true,
        reason: "Accepted",
        now,
      }),
    ).toMatchObject({ result: "accepted" });
    const report = await submitReport(db, {
      guildId,
      reporterUserId: "member-2",
      targetUserId: "member-9",
      note: "Private report",
    });
    expect(report.ticketStatus).toBe("linked");
    expect(report.ticketId).toBeTruthy();
    expect(report.grantsGeneralAccess).toBe(false);
  });

  it("labels uncertain actors and unavailable or retained text", async () => {
    const unknown = await recordStaffLog(db, {
      guildId,
      kind: "message_delete",
      channelId: "general",
      targetId: "message-9",
      content: "deleted text",
      excludedChannelIds: [],
      candidates: [
        { userId: "mod-a", action: "message_delete", targetId: "message-9", at: now },
        { userId: "mod-b", action: "message_delete", targetId: "message-9", at: now },
      ],
      action: "message_delete",
      occurredAt: now,
      now,
    });
    expect(unknown).toMatchObject({ actorUserId: null, actorConfidence: "unknown", contentLabel: "available" });
    const missing = await recordStaffLog(db, {
      guildId,
      kind: "message_delete",
      channelId: "general",
      targetId: "message-10",
      content: null,
      excludedChannelIds: [],
      candidates: [],
      action: "message_delete",
      occurredAt: now,
      now,
    });
    expect(missing.contentLabel).toBe("unavailable");
    const hidden = await recordStaffLog(db, {
      guildId,
      kind: "message",
      channelId: "staff",
      targetId: "message-11",
      content: "staff only",
      excludedChannelIds: ["staff"],
      candidates: [{ userId: "mod", action: "message_create", targetId: "message-11", at: now }],
      action: "message_create",
      occurredAt: now,
      now,
    });
    expect(hidden).toMatchObject({ content: null, contentLabel: "excluded" });
    await db.staffLog.update({ where: { id: unknown.id }, data: { retainUntil: new Date(now.getTime() - 1000) } });
    expect(await retainLog(db, unknown.id, now)).toMatchObject({ changed: true });
    expect(await db.staffLog.findUnique({ where: { id: unknown.id } })).toMatchObject({
      content: null,
      contentLabel: "expired",
    });
    const visible = await searchLogs(db, { guildId, actorRoleIds: ["mod-role"], query: "message_delete" });
    expect(visible.result).toBe("ok");
    if (visible.result !== "ok") {
      throw new Error("Staff log search was denied.");
    }
    expect(visible.logs.some((log) => log.actorConfidence === "unknown" && log.actorUserId === null)).toBe(true);
  });
});
