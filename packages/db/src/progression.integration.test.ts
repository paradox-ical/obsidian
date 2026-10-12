import { randomUUID } from "node:crypto";

import { exampleProgressionSettings, roleStillHeld } from "@collective/domain";
import { afterAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";
import { expireDueGrant, grantSystemRole } from "./community.js";
import { readMemberWallet } from "./ledger.js";
import {
  accrueVoice,
  celebrateBirthday,
  correctInvite,
  givePeerCommendation,
  giveStaffCommendation,
  grantAchievement,
  noteVoiceState,
  qualifyRecruitment,
  readPrivatePreferences,
  readPublicDossier,
  recordActivityXp,
  recordChatActivity,
  recordInviteJoin,
  removeBirthday,
  removeCommendation,
  saveProgressionSettings,
  setBirthday,
  updateDossierPreferences,
} from "./progression.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const now = new Date("2026-10-10T02:00:00.000Z");

afterAll(async () => {
  await db.job.deleteMany({ where: { guildId } });
  await db.outboxMessage.deleteMany({ where: { guildId } });
  await db.voiceSession.deleteMany({ where: { guildId } });
  await db.commendation.deleteMany({ where: { guildId } });
  await db.memberAchievement.deleteMany({ where: { guildId } });
  await db.marketTrade.deleteMany({ where: { guildId } });
  await db.marketQuote.deleteMany({ where: { guildId } });
  await db.collapseCharge.deleteMany({ where: { guildId } });
  await db.ingotMarket.deleteMany({ where: { guildId } });
  await db.ledgerEntry.deleteMany({ where: { guildId } });
  await db.wallet.deleteMany({ where: { guildId } });
  await db.issuanceBudget.deleteMany({ where: { guildId } });
  await db.economySettings.deleteMany({ where: { guildId } });
  await db.rewardEvent.deleteMany({ where: { guildId } });
  await db.inviteEvent.deleteMany({ where: { guildId } });
  await db.inviteMembership.deleteMany({ where: { guildId } });
  await db.birthdayRecord.deleteMany({ where: { guildId } });
  await db.dossierProfile.deleteMany({ where: { guildId } });
  await db.memberProgression.deleteMany({ where: { guildId } });
  await db.roleEntitlement.deleteMany({ where: { guildId } });
  await db.progressionSettings.deleteMany({ where: { guildId } });
  await db.auditRecord.deleteMany({ where: { guildId } });
  await db.capabilityGrant.deleteMany({ where: { guildId } });
  await db.guild.deleteMany({ where: { guildId } });
  await db.$disconnect();
});

describe("community progression", () => {
  it("filters farming, ignores AFK voice, and keeps unrelated permanent roles", async () => {
    const settings = exampleProgressionSettings();
    await saveProgressionSettings(db, {
      guildId,
      actorUserId: "owner",
      reason: "Publish a short XP curve",
      settings: {
        ...settings,
        xpPerLevel: 1,
        messageXp: 5,
        messageCooldownSeconds: 60,
        minimumMessageLength: 4,
        dailyMessageXp: 5,
        repeatWindowSeconds: 300,
        excludedChannelIds: ["ignored"],
        voiceXpPerMinute: 10,
        rankBands: settings.rankBands.map((band) => band.id === "associate" ? { ...band, roleId: "rank-role" } : band),
      },
    });
    expect(await recordChatActivity(db, { guildId, userId: "chatter", channelId: "ignored", content: "hello there", now })).toMatchObject({ result: "excluded", xpGained: 0 });
    expect(await recordChatActivity(db, { guildId, userId: "chatter", channelId: "general", content: null, now })).toMatchObject({ result: "content_unavailable", xpGained: 0 });
    const awarded = await recordChatActivity(db, { guildId, userId: "chatter", channelId: "general", content: "hello there", now });
    expect(awarded).toMatchObject({ result: "award", xpGained: 5, rankName: "Associate" });
    expect(await recordChatActivity(db, { guildId, userId: "chatter", channelId: "general", content: "hello there", now: new Date(now.getTime() + 1000) })).toMatchObject({ result: "repeat" });
    expect(await recordChatActivity(db, { guildId, userId: "chatter", channelId: "general", content: "another line", now: new Date(now.getTime() + 2000) })).toMatchObject({ result: "cooldown" });
    expect(await recordChatActivity(db, { guildId, userId: "chatter", channelId: "general", content: "a different line", now: new Date(now.getTime() + 120_000) })).toMatchObject({ result: "capped" });
    expect(await recordActivityXp("event")).toMatchObject({ result: "module_not_built", xpGained: 0 });

    expect(await noteVoiceState(db, { guildId, userId: "listener", channelId: "voice", afk: true, muted: false, deafened: false, eligibleHumans: 3, now })).toMatchObject({ result: "afk", xpGained: 0 });
    await noteVoiceState(db, { guildId, userId: "listener", channelId: "voice", afk: false, muted: false, deafened: false, eligibleHumans: 2, now });
    const voiced = await accrueVoice(db, guildId, "listener", new Date(now.getTime() + 10 * 60_000));
    expect(voiced.xpGained).toBe(100);
    await noteVoiceState(db, { guildId, userId: "listener", channelId: "afk", afk: true, muted: false, deafened: false, eligibleHumans: 3, now: new Date(now.getTime() + 10 * 60_000) });
    const later = await noteVoiceState(db, { guildId, userId: "listener", channelId: "afk", afk: true, muted: false, deafened: false, eligibleHumans: 3, now: new Date(now.getTime() + 40 * 60_000) });
    expect(later.xpGained).toBe(0);

    await grantSystemRole(db, { guildId, userId: "chatter", roleId: "panel-role", source: "panel", sourceId: "panel:panel-role", kind: "permanent", expiresAt: null, now });
    const panel = await db.roleEntitlement.findFirst({ where: { guildId, userId: "chatter", roleId: "panel-role", source: "panel" } });
    expect(panel?.endedAt).toBeNull();
    const rank = await db.roleEntitlement.findFirst({ where: { guildId, userId: "chatter", source: "rank" } });
    expect(rank?.roleId).toBe("rank-role");
  });

  it("pays recruitment once, refuses unknown and rejoin rewards, and reverses the posted Marks", async () => {
    const joined = await recordInviteJoin(db, { guildId, userId: "stranger", vanity: false, inviterUserIds: [], verifiedAt: now, now });
    expect(joined.confidence).toBe("unknown");
    expect(await qualifyRecruitment(db, guildId, "stranger", new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000))).toMatchObject({ result: "unknown" });

    const verifiedAt = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    await recordInviteJoin(db, { guildId, userId: "recruit", vanity: false, inviterUserIds: ["host"], verifiedAt, now: verifiedAt });
    const qualified = await qualifyRecruitment(db, guildId, "recruit", now);
    expect(qualified).toMatchObject({ result: "recorded", ledgerStatus: "posted" });
    expect(await readMemberWallet(db, guildId, "host")).toMatchObject({ privacy: "public", marks: { status: "available", available: "125.00" }, ingots: { status: "available", available: "0" } });
    expect(await recordInviteJoin(db, { guildId, userId: "recruit", vanity: false, inviterUserIds: ["host"], verifiedAt: now, now })).toMatchObject({ result: "rejoin" });
    expect(await db.rewardEvent.count({ where: { guildId, source: "recruitment", sourceId: "recruit", status: "recorded" } })).toBe(1);

    await db.capabilityGrant.create({ data: { id: randomUUID(), guildId, roleId: "mod-role", capability: "moderation" } });
    await correctInvite(db, { guildId, actorUserId: "mod", actorRoleIds: ["mod-role"], userId: "recruit", inviterUserId: null, confidence: "unknown", reason: "The inviter was not reliable", now });
    expect(await db.rewardEvent.findFirst({ where: { guildId, source: "recruitment", sourceId: "recruit" } })).toMatchObject({ status: "reversed" });
    expect(await readMemberWallet(db, guildId, "host")).toMatchObject({ marks: { available: "25.00" } });
    expect(await db.ledgerEntry.count({ where: { guildId, userId: "host", kind: "issue", source: "recruitment" } })).toBe(1);
    expect(await qualifyRecruitment(db, guildId, "recruit", now)).toMatchObject({ result: "unknown" });
    expect(await db.rewardEvent.count({ where: { guildId, source: "recruitment", sourceId: "recruit" } })).toBe(1);
  });

  it("keeps one birthday gift, hides private dossier fields, and overlaps a permanent role", async () => {
    const settings = exampleProgressionSettings();
    await saveProgressionSettings(db, {
      guildId,
      actorUserId: "owner",
      reason: "Attach a birthday role",
      settings: { ...settings, birthdayRoleId: "birthday-role", birthdayEditCooldownDays: 30 },
    });
    expect(await setBirthday(db, { guildId, userId: "born", month: 10, day: 10, year: null, timeZone: "Australia/Perth", announce: false, now })).toMatchObject({ result: "create" });
    expect(await setBirthday(db, { guildId, userId: "born", month: 11, day: 1, year: null, timeZone: "Australia/Perth", announce: false, now: new Date(now.getTime() + 86_400_000) })).toMatchObject({ result: "cooldown" });
    expect((await db.birthdayRecord.findUnique({ where: { guildId_userId: { guildId, userId: "born" } } }))?.day).toBe(10);

    await grantSystemRole(db, { guildId, userId: "born", roleId: "birthday-role", source: "panel", sourceId: "panel:birthday-role", kind: "permanent", expiresAt: null, now });
    const gift = await celebrateBirthday(db, guildId, "born", now);
    expect(gift).toMatchObject({ result: "recorded", ledgerStatus: "posted" });
    expect(await celebrateBirthday(db, guildId, "born", now)).toMatchObject({ result: "already_recorded" });
    expect(await readMemberWallet(db, guildId, "born")).toMatchObject({ marks: { available: "50.00" } });
    const birthdayGrant = await db.roleEntitlement.findFirst({ where: { guildId, userId: "born", source: "birthday" } });
    if (!birthdayGrant) {
      throw new Error("Birthday role was not granted.");
    }
    await db.roleEntitlement.update({ where: { id: birthdayGrant.id }, data: { expiresAt: new Date(now.getTime() - 1000) } });
    await expireDueGrant(db, birthdayGrant.id, now);
    const grants = await db.roleEntitlement.findMany({ where: { guildId, userId: "born", roleId: "birthday-role" } });
    expect(roleStillHeld(grants.map((grant) => ({ kind: grant.kind === "permanent" ? "permanent" as const : "temporary" as const, endedAt: grant.endedAt, expiresAt: grant.expiresAt, pausedRemainingMs: grant.pausedRemainingMs })), now)).toBe(true);

    await updateDossierPreferences(db, { guildId, userId: "born", bio: "secret bio", bioPublic: false });
    expect(await removeBirthday(db, { guildId, userId: "born", now })).toMatchObject({ result: "removed" });
    const removed = await readPublicDossier(db, guildId, "born");
    expect(removed.birthday).toBeNull();
    expect(removed.wallet.marks).toMatchObject({ status: "available", available: "50.00" });
    expect(removed.wallet.ingots).toMatchObject({ status: "available", available: "0" });
    expect(removed.wallet.estimatedWealth).toMatchObject({ label: "estimated", priceSensitive: true });
    expect(removed.bio).toBeNull();
    expect((await readPrivatePreferences(db, guildId, "born")).bio).toBe("secret bio");

    expect(await givePeerCommendation(db, { guildId, fromUserId: "born", toUserId: "born", category: "thanks", reason: "Myself", now })).toMatchObject({ result: "self", currency: "none" });
    expect(await givePeerCommendation(db, { guildId, fromUserId: "friend", toUserId: "born", category: "thanks", reason: "Helpful", now })).toMatchObject({ result: "recorded", currency: "none" });
    expect(await givePeerCommendation(db, { guildId, fromUserId: "friend", toUserId: "born", category: "thanks", reason: "Again", now: new Date(now.getTime() + 1000) })).toMatchObject({ result: "cooldown" });
    expect(await db.rewardEvent.count({ where: { guildId, source: "commendation" } })).toBe(0);

    const first = await grantAchievement(db, { guildId, userId: "born", achievementId: "quiet-find", now });
    const second = await grantAchievement(db, { guildId, userId: "born", achievementId: "quiet-find", now });
    expect(first.result).toBe("awarded");
    expect(second.result).toBe("already_awarded");
    const staff = await giveStaffCommendation(db, { guildId, actorUserId: "mod", actorRoleIds: ["mod-role"], toUserId: "born", category: "service", reason: "Kept the peace" });
    if (staff.result !== "recorded") {
      throw new Error("Staff commendation was not recorded.");
    }
    const row = await db.commendation.findFirst({ where: { guildId, kind: "staff", toUserId: "born" } });
    expect(await removeCommendation(db, { guildId, actorUserId: "mod", actorRoleIds: ["mod-role"], commendationId: row?.id ?? "", reason: "Posted in error" })).toMatchObject({ result: "removed", retained: true });
    expect(await db.commendation.count({ where: { guildId, kind: "staff" } })).toBe(1);
  });
});
