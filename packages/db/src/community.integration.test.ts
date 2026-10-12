import { randomUUID } from "node:crypto";

import { MEMBER_FLAG_COMPLETED_ONBOARDING, decodeCaptchaPng, type CommunitySettingsInput, type RoleDescriptor } from "@collective/domain";
import { afterAll, describe, expect, it } from "vitest";

import {
  expireDueGrant,
  grantTemporaryRole,
  noteMemberAbsence,
  proveOwnership,
  publishPanel,
  reconcileMember,
  requestAssistance,
  saveCommunitySettings,
  saveHandle,
  shippedOwnershipAdapter,
  startCaptcha,
  submitCaptcha,
  togglePanelRole,
} from "./community.js";
import { createPrismaClient } from "./client.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const userId = "member-1";
const now = new Date("2026-10-07T01:00:00.000Z");
const verifiedRole: RoleDescriptor = { id: `verified-${guildId}`, name: "Verified", position: 2, permissions: "0", managed: false };
const regionRole: RoleDescriptor = { id: `region-${guildId}`, name: "Region", position: 2, permissions: "0", managed: false };
const adminRole: RoleDescriptor = { id: `admin-${guildId}`, name: "Admin", position: 2, permissions: "8", managed: false };
const nativeDone = { pending: false, flags: MEMBER_FLAG_COMPLETED_ONBOARDING };
const settings: CommunitySettingsInput = {
  verifiedRoleId: verifiedRole.id,
  assistanceChannelId: "assist",
  screeningEnabled: true,
  onboardingEnabled: true,
  pauseEntitlementsWhileAbsent: false,
  channels: [
    { channelId: "rules", label: "rules", audiences: ["pending", "onboarding", "verified"] },
    { channelId: "lobby", label: "lobby", audiences: ["onboarding", "verified"] },
  ],
  progressionRoleIds: [`rank-${guildId}`],
  onboardingRoleIds: [regionRole.id],
};

afterAll(async () => {
  await db.outboxMessage.deleteMany({ where: { guildId } });
  await db.job.deleteMany({ where: { guildId } });
  await db.roleEntitlement.deleteMany({ where: { guildId } });
  await db.rolePanelOption.deleteMany({ where: { roleId: { in: [regionRole.id, adminRole.id, verifiedRole.id] } } });
  await db.rolePanelPost.deleteMany({ where: { guildId } });
  await db.rolePanel.deleteMany({ where: { guildId } });
  await db.captchaChallenge.deleteMany({ where: { guildId } });
  await db.assistanceRequest.deleteMany({ where: { guildId } });
  await db.wallet.deleteMany({ where: { guildId } });
  await db.dossierProfile.deleteMany({ where: { guildId } });
  await db.verificationRecord.deleteMany({ where: { guildId } });
  await db.linkedAccount.deleteMany({ where: { guildId } });
  await db.auditRecord.deleteMany({ where: { guildId } });
  await db.capabilityGrant.deleteMany({ where: { guildId } });
  await db.communitySettings.deleteMany({ where: { guildId } });
  await db.$disconnect();
});

describe("verification, roles, entitlements, and accounts", () => {
  it("restores a verified member without a new CAPTCHA and withholds access until native steps finish", async () => {
    const hidden = await saveCommunitySettings(db, {
      guildId,
      settings: { ...settings, channels: [{ channelId: "hall", label: "hall", audiences: ["verified"] }] },
      roles: [verifiedRole],
      actorUserId: "owner",
      reason: "Try a closed map",
    });
    expect(hidden.ok).toBe(false);
    expect(await db.communitySettings.findUnique({ where: { guildId } })).toBeNull();

    expect(
      (await saveCommunitySettings(db, { guildId, settings, roles: [verifiedRole, regionRole], actorUserId: "owner", reason: "Publish verification" })).ok,
    ).toBe(true);

    const blocked = await startCaptcha(db, { guildId, userId, native: { pending: true, flags: 0 }, now });
    expect(blocked).toMatchObject({ result: "ineligible", reason: "native_pending" });
    const unknown = await startCaptcha(db, { guildId, userId, native: { pending: null, flags: null }, now });
    expect(unknown).toMatchObject({ result: "ineligible", reason: "missing_eligibility" });

    const started = await startCaptcha(db, { guildId, userId, native: nativeDone, now });
    expect(started.result).toBe("challenge");
    if (started.result !== "challenge") {
      throw new Error("CAPTCHA did not start.");
    }
    const code = decodeCaptchaPng(started.image);
    expect(JSON.stringify({ challengeId: started.challengeId })).not.toContain(code);
    await db.captchaChallenge.update({ where: { id: started.challengeId }, data: { expiresAt: new Date(now.getTime() - 1000) } });
    expect(await submitCaptcha(db, { guildId, userId, challengeId: started.challengeId, answer: code, now })).toMatchObject({
      result: "expired",
    });
    expect((await db.verificationRecord.findUnique({ where: { guildId_userId: { guildId, userId } } }))?.failureCount ?? 0).toBe(0);

    const fresh = await startCaptcha(db, { guildId, userId, native: nativeDone, now: new Date(now.getTime() + 1000) });
    if (fresh.result !== "challenge") {
      throw new Error("Replacement CAPTCHA did not start.");
    }
  for (const answer of ["ZZZZZZ", "YYYYYY", "XXXXXX"]) {
      expect(
        (await submitCaptcha(db, { guildId, userId, challengeId: fresh.challengeId, answer, now: new Date(now.getTime() + 2000) })).result,
      ).toBe("incorrect");
    }
    expect(
      (await startCaptcha(db, { guildId, userId, native: nativeDone, now: new Date(now.getTime() + 3000) })).result,
    ).toBe("cooldown");

    await db.verificationRecord.update({
      where: { guildId_userId: { guildId, userId } },
      data: { failureCount: 0, cooldownUntil: null },
    });
    const passed = await startCaptcha(db, { guildId, userId, native: nativeDone, now: new Date(now.getTime() + 4000) });
    if (passed.result !== "challenge") {
      throw new Error("Cooldown did not clear.");
    }
    expect(
      await submitCaptcha(db, {
        guildId,
        userId,
        challengeId: passed.challengeId,
        answer: decodeCaptchaPng(passed.image),
        now: new Date(now.getTime() + 5000),
      }),
    ).toMatchObject({ result: "verified" });
    await db.wallet.create({ data: { guildId, userId, currency: "marks", availableMinor: 2500n, escrowMinor: 100n } });
    await db.dossierProfile.create({ data: { guildId, userId, bio: "kept", bioPublic: false } });
    const beforeRejoin = await db.captchaChallenge.count({ where: { guildId, userId } });
    await db.roleEntitlement.updateMany({
      where: { guildId, userId, source: "verification" },
      data: { endedAt: new Date(now.getTime() + 6000), endReason: "left" },
    });
    expect(
      await reconcileMember(db, { guildId, userId, native: nativeDone, now: new Date(now.getTime() + 7000) }),
    ).toMatchObject({ result: "restored", captchaIssued: false });
    expect(await db.captchaChallenge.count({ where: { guildId, userId } })).toBe(beforeRejoin);
    const wallet = await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId, userId, currency: "marks" } } });
    expect(wallet?.availableMinor).toBe(2500n);
    expect(wallet?.escrowMinor).toBe(100n);
    expect((await db.dossierProfile.findUnique({ where: { guildId_userId: { guildId, userId } } }))?.bio).toBe("kept");
    const waiting = await reconcileMember(db, {
      guildId,
      userId,
      native: { pending: false, flags: 0 },
      now: new Date(now.getTime() + 8000),
    });
    expect(waiting).toMatchObject({ result: "waiting_for_native", captchaIssued: false });

    const help = await requestAssistance(db, { guildId, userId: "other-member", note: "I cannot see the image", now });
    expect(help.access).toBe("unchanged");
    expect(await db.verificationRecord.findUnique({ where: { guildId_userId: { guildId, userId: "other-member" } } })).toBeNull();
  });

  it("rejects protected roles and removes an expired grant only when nothing else still holds it", async () => {
    await db.capabilityGrant.create({
      data: { id: randomUUID(), guildId, roleId: "mod-role", capability: "moderation" },
    });
    const protectedPanel = await publishPanel(db, {
      guildId,
      name: "Staff",
      mode: "button",
      selection: "multiple",
      options: [{ roleId: adminRole.id, label: "Admin" }],
      roles: [adminRole],
      botHighestPosition: 10,
      actorUserId: "owner",
      reason: "Attempt a privileged panel",
    });
    expect(protectedPanel).toMatchObject({ ok: false, reason: "privileged" });
    const reaction = await publishPanel(db, {
      guildId,
      name: "Platform",
      mode: "reaction",
      selection: "multiple",
      options: [{ roleId: regionRole.id, label: "Region" }],
      roles: [regionRole],
      botHighestPosition: 10,
      actorUserId: "owner",
      reason: "Reaction panel without emoji",
    });
    expect(reaction).toMatchObject({ ok: false, reason: "missing_emoji" });

    const panel = await publishPanel(db, {
      guildId,
      name: "Region",
      mode: "select",
      selection: "single",
      options: [{ roleId: regionRole.id, label: "Region" }],
      roles: [regionRole],
      botHighestPosition: 10,
      actorUserId: "owner",
      reason: "Publish the onboarding region role",
    });
    expect(panel.ok).toBe(true);
    expect(await togglePanelRole(db, {
      guildId,
      userId,
      roleId: regionRole.id,
      clear: false,
      heldRoleIds: [],
      now,
      assignment: { roles: [regionRole], botHighestPosition: 10 },
    })).toMatchObject({
      ok: true,
    });
    expect(await togglePanelRole(db, {
      guildId,
      userId,
      roleId: regionRole.id,
      clear: false,
      heldRoleIds: [],
      now,
      assignment: { roles: [{ ...regionRole, permissions: "8" }], botHighestPosition: 10 },
    })).toMatchObject({ ok: false, reason: "privileged" });
    const granted = await grantTemporaryRole(db, {
      guildId,
      actorUserId: "mod",
      actorRoleIds: ["mod-role"],
      userId,
      roleId: regionRole.id,
      days: 3,
      reason: "Event weekend",
      now,
    });
    expect(granted.result).toBe("granted");
    const renewed = await grantTemporaryRole(db, {
      guildId,
      actorUserId: "mod",
      actorRoleIds: ["mod-role"],
      userId,
      roleId: regionRole.id,
      days: 7,
      reason: "Stack the weekend",
      now,
    });
    expect(renewed.result).toBe("granted");
    if (renewed.result !== "granted") {
      throw new Error("Renewal did not stack.");
    }
    expect(renewed.expiresAt.getTime() - now.getTime()).toBe(10 * 24 * 60 * 60 * 1000);

    const temporary = await db.roleEntitlement.findFirstOrThrow({
      where: { guildId, userId, roleId: regionRole.id, source: "staff", endedAt: null },
    });
    await db.roleEntitlement.update({ where: { id: temporary.id }, data: { expiresAt: new Date(now.getTime() - 1000) } });
    expect(await expireDueGrant(db, temporary.id, now)).toMatchObject({ changed: true });
    const stillHeld = await db.roleEntitlement.findMany({ where: { guildId, userId, roleId: regionRole.id } });
    expect(stillHeld.some((grant) => grant.source === "panel" && grant.endedAt === null)).toBe(true);
    const removalWhilePermanent = await db.outboxMessage.findMany({
      where: { guildId, eventType: "discord.role.update" },
      orderBy: { createdAt: "desc" },
    });
    expect(JSON.stringify(removalWhilePermanent[0]?.payload)).toContain("\"action\":\"add\"");

    expect(await noteMemberAbsence(db, { guildId, userId, now })).toEqual({ paused: false });
    await togglePanelRole(db, { guildId, userId, roleId: regionRole.id, clear: true, heldRoleIds: [], now });
    const afterClear = await db.outboxMessage.findFirst({
      where: { guildId, eventType: "discord.role.update" },
      orderBy: { createdAt: "desc" },
    });
    expect(JSON.stringify(afterClear?.payload)).toContain("\"action\":\"remove\"");
  });

  it("saves self-reported handles while ownership proof stays setup-required", async () => {
    const saved = await saveHandle(db, { guildId, userId, provider: "steam", handle: "example" });
    expect(saved).toMatchObject({ ownership: "self_reported", ordinaryAccess: "unaffected" });
    const adapter = { prove: async () => ({ verified: true as const, subject: "should-not-run" }) };
    const missing = await proveOwnership(db, { guildId, userId, provider: "steam", credentials: {}, adapter });
    expect(missing).toMatchObject({ result: "setup_required", adapterCalled: false, ownership: "self_reported" });
    const shipped = await proveOwnership(db, {
      guildId,
      userId,
      provider: "steam",
      credentials: { STEAM_WEB_API_KEY: "present" },
      adapter: shippedOwnershipAdapter,
    });
    expect(shipped).toMatchObject({ result: "setup_required", adapterCalled: true, ownership: "self_reported" });
    const verified = await proveOwnership(db, {
      guildId,
      userId,
      provider: "steam",
      credentials: { STEAM_WEB_API_KEY: "present" },
      adapter: { prove: async () => ({ verified: true, subject: "steam-subject" }) },
    });
    expect(verified).toMatchObject({ result: "verified", ownership: "verified" });
    const minecraft = await saveHandle(db, { guildId, userId, provider: "minecraft", handle: "miner" });
    expect(minecraft.ownership).toBe("self_reported");
    expect(
      await proveOwnership(db, { guildId, userId, provider: "minecraft", credentials: {}, adapter }),
    ).toMatchObject({ reason: "ownership_proof_unavailable", adapterCalled: false });
    expect(await startCaptcha(db, { guildId, userId: "no-account", native: nativeDone, now })).toMatchObject({ result: "challenge" });
  });
});
