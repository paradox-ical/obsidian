import { randomUUID } from "node:crypto";

import {
  activityXpStatus,
  bandForLevel,
  birthdayEditDecision,
  birthdayIsToday,
  chatXpDecision,
  contentHash,
  exampleProgressionSettings,
  inviteConfidence,
  levelForXp,
  peerCommendationDecision,
  prepareProgressionSettings,
  publicDossier,
  readPublicWallet,
  recruitmentDecision,
  validBirthdayDate,
  voiceXpDecision,
  zonedYear,
  type ProgressionSettingsInput,
} from "@collective/domain";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

import { issueMarks, reverseMarks } from "./ledger.js";
import { readValuedWallet } from "./market.js";

import { endSystemGrant, grantSystemRole } from "./community.js";
import { actorCan, enqueueJob, enqueueOutbox, ensureGuild, writeAudit, type Writer } from "./platform.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export class ProgressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProgressionError";
  }
}

function asSettings(value: unknown): ProgressionSettingsInput | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const settings = value as ProgressionSettingsInput;
  if (!Array.isArray(settings.rankBands) || typeof settings.xpPerLevel !== "number") {
    return null;
  }
  return settings;
}

function dayKey(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Perth", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

async function settingsOf(db: Writer, guildId: string) {
  await ensureGuild(db, { guildId });
  const row = await db.progressionSettings.findUnique({ where: { guildId } });
  if (!row) {
    const settings = exampleProgressionSettings();
    await db.progressionSettings.create({
      data: { guildId, version: 1, label: settings.label, document: settings as unknown as Prisma.InputJsonValue },
    });
    return { version: 1, settings };
  }
  const settings = asSettings(row.document);
  if (!settings) {
    throw new ProgressionError("Stored progression settings are unreadable.");
  }
  return { version: row.version, settings: prepareProgressionSettings(settings) };
}

export async function readProgressionSettings(db: Writer, guildId: string) {
  const stored = await db.progressionSettings.findUnique({ where: { guildId } });
  if (!stored) {
    return { stored: false as const, version: 0, settings: exampleProgressionSettings(), wallet: readPublicWallet() };
  }
  const settings = asSettings(stored.document);
  if (!settings) {
    throw new ProgressionError("Stored progression settings are unreadable.");
  }
  return { stored: true as const, version: stored.version, settings: prepareProgressionSettings(settings), wallet: readPublicWallet() };
}

export async function saveProgressionSettings(
  db: Writer,
  input: { guildId: string; settings: ProgressionSettingsInput; actorUserId: string; reason: string },
) {
  await ensureGuild(db, { guildId: input.guildId });
  const settings = prepareProgressionSettings(input.settings);
  const current = await db.progressionSettings.findUnique({ where: { guildId: input.guildId } });
  const version = (current?.version ?? 0) + 1;
  await db.progressionSettings.upsert({
    where: { guildId: input.guildId },
    create: { guildId: input.guildId, version, label: settings.label, document: settings as unknown as Prisma.InputJsonValue },
    update: { version, label: settings.label, document: settings as unknown as Prisma.InputJsonValue },
  });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "progression.settings",
    targetType: "progression_settings",
    targetId: input.guildId,
    reason: input.reason,
  });
  return { version, settings, wallet: readPublicWallet() };
}

async function progressionRow(db: Writer, guildId: string, userId: string, now: Date) {
  const key = dayKey(now);
  const existing = await db.memberProgression.findUnique({ where: { guildId_userId: { guildId, userId } } });
  if (!existing) {
    return db.memberProgression.create({ data: { guildId, userId, dailyKey: key } });
  }
  if (existing.dailyKey !== key) {
    return db.memberProgression.update({
      where: { guildId_userId: { guildId, userId } },
      data: { dailyKey: key, dailyMessageXp: 0, dailyVoiceXp: 0 },
    });
  }
  return existing;
}

async function syncRank(db: Writer, guildId: string, userId: string, xp: number, settings: ProgressionSettingsInput, now: Date) {
  const level = levelForXp(xp, settings.xpPerLevel);
  const band = bandForLevel(level, settings.rankBands);
  const row = await db.memberProgression.findUnique({ where: { guildId_userId: { guildId, userId } } });
  if (!band || row?.rankBandId === band.id) {
    return { level, rankName: band?.name ?? null };
  }
  const previous = settings.rankBands.find((item) => item.id === row?.rankBandId);
  if (previous?.roleId) {
    await endSystemGrant(db, { guildId, userId, roleId: previous.roleId, source: "rank", sourceId: previous.id, now, endReason: "rank_changed" });
  }
  if (band.roleId) {
    await grantSystemRole(db, { guildId, userId, roleId: band.roleId, source: "rank", sourceId: band.id, kind: "permanent", expiresAt: null, now });
  }
  await db.memberProgression.update({ where: { guildId_userId: { guildId, userId } }, data: { rankBandId: band.id } });
  return { level, rankName: band.name };
}

async function addXp(db: Writer, guildId: string, userId: string, amount: number, settings: ProgressionSettingsInput, now: Date) {
  const row = await progressionRow(db, guildId, userId, now);
  const xp = row.xp + amount;
  await db.memberProgression.update({ where: { guildId_userId: { guildId, userId } }, data: { xp } });
  return syncRank(db, guildId, userId, xp, settings, now);
}

export async function recordChatActivity(
  db: Writer,
  input: { guildId: string; userId: string; channelId: string; content: string | null; now: Date },
) {
  const { settings } = await settingsOf(db, input.guildId);
  const row = await progressionRow(db, input.guildId, input.userId, input.now);
  const decision = chatXpDecision({
    content: input.content,
    channelId: input.channelId,
    excludedChannelIds: settings.excludedChannelIds,
    now: input.now,
    lastMessageAt: row.lastMessageAt,
    cooldownSeconds: settings.messageCooldownSeconds,
    lastHash: row.lastHash,
    lastHashAt: row.lastHashAt,
    repeatWindowSeconds: settings.repeatWindowSeconds,
    minimumLength: settings.minimumMessageLength,
    dailyXp: row.dailyMessageXp,
    dailyCap: settings.dailyMessageXp,
    messageXp: settings.messageXp,
  });
  if (decision !== "award" || !input.content) {
    return { result: decision, xpGained: 0 };
  }
  const gained = Math.min(settings.messageXp, settings.dailyMessageXp - row.dailyMessageXp);
  await db.memberProgression.update({
    where: { guildId_userId: { guildId: input.guildId, userId: input.userId } },
    data: {
      lastMessageAt: input.now,
      lastHash: contentHash(input.content),
      lastHashAt: input.now,
      dailyMessageXp: row.dailyMessageXp + gained,
    },
  });
  const rank = await addXp(db, input.guildId, input.userId, gained, settings, input.now);
  if (row.xp === 0) {
    await grantAchievement(db, { guildId: input.guildId, userId: input.userId, achievementId: "first-chat", now: input.now });
  }
  return { result: "award" as const, xpGained: gained, ...rank };
}

export async function recordActivityXp(source: "event" | "contract") {
  void source;
  return { result: activityXpStatus(), xpGained: 0 as const };
}

export async function noteVoiceState(
  db: Writer,
  input: { guildId: string; userId: string; channelId: string; afk: boolean; muted: boolean; deafened: boolean; eligibleHumans: number; now: Date },
) {
  const { settings } = await settingsOf(db, input.guildId);
  const row = await progressionRow(db, input.guildId, input.userId, input.now);
  const eligibility = voiceXpDecision({
    afk: input.afk,
    muted: input.muted,
    deafened: input.deafened,
    eligibleHumans: input.eligibleHumans,
    minHumans: settings.voiceMinHumans,
    minutes: 0,
    dailyXp: row.dailyVoiceXp,
    dailyCap: settings.dailyVoiceXp,
    xpPerMinute: settings.voiceXpPerMinute,
  });
  const session = await db.voiceSession.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
  if (eligibility.result === "afk" || eligibility.result === "muted" || eligibility.result === "deafened" || eligibility.result === "alone") {
    if (!session) {
      return { result: eligibility.result, xpGained: 0 };
    }
    const accrued = await accrueVoiceSession(db, input.guildId, input.userId, input.now);
    await db.voiceSession.delete({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
    return { result: eligibility.result, xpGained: accrued.xpGained };
  }
  if (!session) {
    await db.voiceSession.create({
      data: { guildId: input.guildId, userId: input.userId, channelId: input.channelId, lastAwardedAt: input.now, eligibleHumans: input.eligibleHumans },
    });
  } else {
    await db.voiceSession.update({
      where: { guildId_userId: { guildId: input.guildId, userId: input.userId } },
      data: { channelId: input.channelId, eligibleHumans: input.eligibleHumans },
    });
  }
  return { result: "tracking" as const, xpGained: 0 };
}

async function accrueVoiceSession(db: Writer, guildId: string, userId: string, now: Date) {
  const { settings } = await settingsOf(db, guildId);
  const session = await db.voiceSession.findUnique({ where: { guildId_userId: { guildId, userId } } });
  if (!session) {
    return { xpGained: 0 };
  }
  const row = await progressionRow(db, guildId, userId, now);
  const minutes = Math.floor((now.getTime() - session.lastAwardedAt.getTime()) / 60_000);
  const decision = voiceXpDecision({
    afk: false,
    muted: false,
    deafened: false,
    eligibleHumans: session.eligibleHumans,
    minHumans: settings.voiceMinHumans,
    minutes,
    dailyXp: row.dailyVoiceXp,
    dailyCap: settings.dailyVoiceXp,
    xpPerMinute: settings.voiceXpPerMinute,
  });
  if (decision.xp <= 0) {
    return { xpGained: 0 };
  }
  await db.memberProgression.update({
    where: { guildId_userId: { guildId, userId } },
    data: { dailyVoiceXp: row.dailyVoiceXp + decision.xp },
  });
  await db.voiceSession.update({
    where: { guildId_userId: { guildId, userId } },
    data: { lastAwardedAt: new Date(session.lastAwardedAt.getTime() + minutes * 60_000) },
  });
  await addXp(db, guildId, userId, decision.xp, settings, now);
  return { xpGained: decision.xp };
}

export async function accrueVoice(db: Writer, guildId: string, userId: string, now: Date) {
  return accrueVoiceSession(db, guildId, userId, now);
}

export async function sweepVoiceAccrual(db: PrismaClient, now: Date) {
  const sessions = await db.voiceSession.findMany({ take: 50 });
  let changed = 0;
  for (const session of sessions) {
    const result = await accrueVoiceSession(db, session.guildId, session.userId, now);
    if (result.xpGained > 0) {
      changed += 1;
    }
  }
  return { changed };
}

function ledgerRoot(db: Writer): PrismaClient | null {
  return "$transaction" in db ? (db as PrismaClient) : null;
}

export async function recordReward(
  db: Writer,
  input: { guildId: string; userId: string; source: string; sourceId: string; kind: "marks" | "badge" | "title"; amount: number | null; now: Date },
) {
  const idempotencyKey = `${input.source}:${input.guildId}:${input.userId}:${input.sourceId}`;
  const existing = await db.rewardEvent.findUnique({ where: { idempotencyKey } });
  if (existing) {
    return { result: "already_recorded" as const, rewardId: existing.id, ledgerStatus: existing.ledgerStatus };
  }
  let ledgerStatus = "not_applicable";
  if (input.kind === "marks" && (input.amount ?? 0) > 0) {
    const root = ledgerRoot(db);
    if (!root) {
      return { result: "invalid" as const, ledgerStatus: "not_posted" };
    }
    const issued = await issueMarks(root, {
      guildId: input.guildId,
      userId: input.userId,
      amountMarks: input.amount ?? 0,
      source: input.source,
      sourceId: input.sourceId,
      pace: "routine",
      idempotencyKey,
      reason: input.source,
      actorUserId: "system",
      now: input.now,
    });
    if (issued.result !== "posted" && issued.result !== "already_recorded") {
      return { result: issued.result, ledgerStatus: "not_posted" };
    }
    ledgerStatus = "posted";
  }
  const id = randomUUID();
  try {
    await db.rewardEvent.create({
      data: {
        id,
        guildId: input.guildId,
        userId: input.userId,
        source: input.source,
        sourceId: input.sourceId,
        kind: input.kind,
        amount: input.amount,
        ledgerStatus,
        status: "recorded",
        idempotencyKey,
      },
    });
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "P2002")) {
      throw error;
    }
    const raced = await db.rewardEvent.findUnique({ where: { idempotencyKey } });
    return { result: "already_recorded" as const, rewardId: raced?.id ?? id, ledgerStatus: raced?.ledgerStatus ?? ledgerStatus };
  }
  return { result: "recorded" as const, rewardId: id, ledgerStatus };
}

export { recordReward as recordSharedReward };

export async function grantAchievement(
  db: Writer,
  input: { guildId: string; userId: string; achievementId: string; now: Date },
) {
  const { settings } = await settingsOf(db, input.guildId);
  const definition = settings.achievements.find((achievement) => achievement.id === input.achievementId);
  if (!definition) {
    return { result: "missing" as const };
  }
  const existing = await db.memberAchievement.findUnique({
    where: { guildId_userId_achievementId: { guildId: input.guildId, userId: input.userId, achievementId: definition.id } },
  });
  if (existing) {
    return { result: "already_awarded" as const };
  }
  await db.memberAchievement.create({
    data: { guildId: input.guildId, userId: input.userId, achievementId: definition.id, earnedAt: input.now },
  });
  const reward = definition.marks > 0
    ? await recordReward(db, {
        guildId: input.guildId,
        userId: input.userId,
        source: "achievement",
        sourceId: definition.id,
        kind: "marks",
        amount: definition.marks,
        now: input.now,
      })
    : await recordReward(db, {
        guildId: input.guildId,
        userId: input.userId,
        source: "achievement",
        sourceId: definition.id,
        kind: "badge",
        amount: null,
        now: input.now,
      });
  return { result: "awarded" as const, ledgerStatus: reward.ledgerStatus };
}

export async function recordInviteJoin(
  db: Writer,
  input: { guildId: string; userId: string; vanity: boolean; inviterUserIds: readonly string[]; verifiedAt: Date | null; now: Date },
) {
  const { settings } = await settingsOf(db, input.guildId);
  const attribution = inviteConfidence({ vanity: input.vanity, inviterUserIds: input.inviterUserIds });
  const existing = await db.inviteMembership.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
  const recent = attribution.inviterUserId
    ? await db.inviteEvent.count({
        where: { guildId: input.guildId, inviterUserId: attribution.inviterUserId, createdAt: { gte: new Date(input.now.getTime() - HOUR_MS) } },
      })
    : 0;
  const suspicious = recent >= 8;
  const rejoin = Boolean(existing?.rewardedAt);
  await db.inviteEvent.create({
    data: {
      id: randomUUID(),
      guildId: input.guildId,
      userId: input.userId,
      confidence: attribution.confidence,
      inviterUserId: attribution.inviterUserId,
      rejoin,
      suspicious,
    },
  });
  if (existing?.rewardedAt) {
    await db.inviteMembership.update({
      where: { guildId_userId: { guildId: input.guildId, userId: input.userId } },
      data: { rejoin: true, suspicious },
    });
    return { result: "rejoin" as const, confidence: attribution.confidence, reward: "none" as const };
  }
  const verifiedAt = input.verifiedAt ?? existing?.verifiedAt ?? null;
  if (existing) {
    await db.inviteMembership.update({
      where: { guildId_userId: { guildId: input.guildId, userId: input.userId } },
      data: { confidence: attribution.confidence, inviterUserId: attribution.inviterUserId, joinedAt: input.now, verifiedAt, suspicious, rejoin: false },
    });
  } else {
    await db.inviteMembership.create({
      data: {
        guildId: input.guildId,
        userId: input.userId,
        confidence: attribution.confidence,
        inviterUserId: attribution.inviterUserId,
        joinedAt: input.now,
        verifiedAt,
        suspicious,
      },
    });
  }
  if (verifiedAt && attribution.confidence === "known") {
    await enqueueJob(db, {
      guildId: input.guildId,
      jobType: "progression.invite.qualify",
      payload: { guildId: input.guildId, userId: input.userId },
      idempotencyKey: `invite-qualify:${input.guildId}:${input.userId}:${verifiedAt.toISOString()}`,
      runAt: new Date(verifiedAt.getTime() + settings.qualifiedDays * DAY_MS),
    });
  }
  return { result: "recorded" as const, confidence: attribution.confidence, suspicious };
}

export async function qualifyRecruitment(db: Writer, guildId: string, userId: string, now: Date) {
  const { settings } = await settingsOf(db, guildId);
  const membership = await db.inviteMembership.findUnique({ where: { guildId_userId: { guildId, userId } } });
  if (!membership || !membership.inviterUserId) {
    return { result: membership ? ("unknown" as const) : ("missing" as const) };
  }
  const awardedToday = await db.rewardEvent.count({
    where: {
      guildId,
      userId: membership.inviterUserId,
      source: "recruitment",
      status: "recorded",
      createdAt: { gte: new Date(now.getTime() - DAY_MS) },
    },
  });
  const decision = recruitmentDecision({
    confidence: membership.confidence === "known" || membership.confidence === "vanity" || membership.confidence === "unknown" || membership.confidence === "ambiguous" ? membership.confidence : "unknown",
    rejoin: membership.rejoin,
    verifiedAt: membership.verifiedAt,
    now,
    qualifiedDays: settings.qualifiedDays,
    alreadyRewarded: membership.rewardedAt !== null,
    inviterAwardsToday: awardedToday,
    dailyCap: settings.inviteDailyCap,
  });
  if (decision !== "reward") {
    return { result: decision };
  }
  const reward = await recordReward(db, {
    guildId,
    userId: membership.inviterUserId,
    source: "recruitment",
    sourceId: userId,
    kind: "marks",
    amount: settings.inviteRewardMarks,
    now,
  });
  if (reward.result === "recorded") {
    await db.inviteMembership.update({ where: { guildId_userId: { guildId, userId } }, data: { rewardedAt: now } });
    await grantAchievement(db, { guildId, userId: membership.inviterUserId, achievementId: "recruiter", now });
  }
  return { result: reward.result, ledgerStatus: reward.ledgerStatus };
}

export async function correctInvite(
  db: Writer,
  input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; userId: string; inviterUserId: string | null | undefined; confidence: "known" | "unknown" | "vanity" | "ambiguous"; reason: string; now: Date },
) {
  const allowed = await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "moderation" });
  if (allowed === "denied") {
    return { result: "denied" as const };
  }
  const membership = await db.inviteMembership.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
  if (!membership) {
    return { result: "missing" as const };
  }
  await db.inviteMembership.update({
    where: { guildId_userId: { guildId: input.guildId, userId: input.userId } },
    data: {
      confidence: input.confidence,
      ...(input.inviterUserId !== undefined ? { inviterUserId: input.inviterUserId } : {}),
    },
  });
  await db.inviteEvent.create({
    data: {
      id: randomUUID(),
      guildId: input.guildId,
      userId: input.userId,
      confidence: input.confidence,
      inviterUserId: input.inviterUserId === undefined ? membership.inviterUserId : input.inviterUserId,
      rejoin: membership.rejoin,
      suspicious: false,
    },
  });
  if (membership.rewardedAt && input.confidence !== "known") {
    const reward = await db.rewardEvent.findFirst({
      where: { guildId: input.guildId, source: "recruitment", sourceId: input.userId, status: "recorded" },
    });
    if (reward?.ledgerStatus === "posted") {
      const root = ledgerRoot(db);
      const reversed = root
        ? await reverseMarks(root, { idempotencyKey: reward.idempotencyKey, reason: input.reason, actorUserId: input.actorUserId, now: input.now })
        : { result: "invalid" as const };
      if (reversed.result === "insufficient" || reversed.result === "invalid" || reversed.result === "missing") {
        await writeAudit(db, {
          guildId: input.guildId,
          actorUserId: input.actorUserId,
          action: "progression.invite.correct",
          targetType: "invite_membership",
          targetId: input.userId,
          reason: input.reason,
        });
        return { result: reversed.result === "insufficient" ? "insufficient" as const : "invalid" as const };
      }
    }
    await db.rewardEvent.updateMany({
      where: { guildId: input.guildId, source: "recruitment", sourceId: input.userId, status: "recorded" },
      data: { status: "reversed" },
    });
    await db.inviteMembership.update({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } }, data: { rewardedAt: null } });
  }
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "progression.invite.correct",
    targetType: "invite_membership",
    targetId: input.userId,
    reason: input.reason,
  });
  return { result: "corrected" as const };
}

export async function listInviteHistory(
  db: Writer,
  input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[] },
) {
  const allowed = await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "moderation" });
  if (allowed === "denied") {
    return { result: "denied" as const, events: [] };
  }
  const events = await db.inviteEvent.findMany({ where: { guildId: input.guildId }, orderBy: { createdAt: "desc" }, take: 50 });
  return {
    result: "ok" as const,
    events: events.map((event) => ({
      userId: event.userId,
      confidence: event.confidence,
      inviterUserId: event.inviterUserId,
      rejoin: event.rejoin,
      suspicious: event.suspicious,
    })),
  };
}

export async function setBirthday(
  db: Writer,
  input: { guildId: string; userId: string; month: number; day: number; year: number | null; timeZone: string; announce: boolean; now: Date },
) {
  if (!validBirthdayDate(input.month, input.day)) {
    return { result: "invalid_date" as const };
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone }).format(input.now);
  } catch {
    return { result: "invalid_timezone" as const };
  }
  const { settings } = await settingsOf(db, input.guildId);
  const existing = await db.birthdayRecord.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
  const decision = birthdayEditDecision({ previousEditAt: existing?.deletedAt ? null : existing?.editedAt ?? null, now: input.now, cooldownDays: settings.birthdayEditCooldownDays });
  if (decision === "cooldown") {
    await writeAudit(db, {
      guildId: input.guildId,
      actorUserId: input.userId,
      action: "progression.birthday.cooldown",
      targetType: "birthday_record",
      targetId: input.userId,
      reason: "Birthday date edit is inside the cooldown.",
    });
    return { result: "cooldown" as const };
  }
  await db.birthdayRecord.upsert({
    where: { guildId_userId: { guildId: input.guildId, userId: input.userId } },
    create: { guildId: input.guildId, userId: input.userId, month: input.month, day: input.day, year: input.year, timeZone: input.timeZone, announce: input.announce, editedAt: input.now },
    update: { month: input.month, day: input.day, year: input.year, timeZone: input.timeZone, announce: input.announce, deletedAt: null, editedAt: decision === "edit" ? input.now : existing?.editedAt ?? null },
  });
  if (decision === "edit") {
    await writeAudit(db, {
      guildId: input.guildId,
      actorUserId: input.userId,
      action: "progression.birthday.edit",
      targetType: "birthday_record",
      targetId: input.userId,
      reason: "Birthday date changed.",
    });
  }
  return { result: decision };
}

export async function removeBirthday(db: Writer, input: { guildId: string; userId: string; now: Date }) {
  await db.birthdayRecord.updateMany({
    where: { guildId: input.guildId, userId: input.userId },
    data: { month: null, day: null, year: null, announce: false, deletedAt: input.now },
  });
  return { result: "removed" as const };
}

export async function celebrateBirthday(db: Writer, guildId: string, userId: string, now: Date) {
  const { settings } = await settingsOf(db, guildId);
  const birthday = await db.birthdayRecord.findUnique({ where: { guildId_userId: { guildId, userId } } });
  if (!birthday || birthday.deletedAt || birthday.month === null || birthday.day === null) {
    return { result: "missing" as const };
  }
  if (!birthdayIsToday({ month: birthday.month, day: birthday.day, timeZone: birthday.timeZone, now, leapDayPolicy: settings.leapDayPolicy })) {
    return { result: "not_today" as const };
  }
  const year = zonedYear(now, birthday.timeZone);
  const reward = await recordReward(db, {
    guildId,
    userId,
    source: "birthday",
    sourceId: String(year),
    kind: "marks",
    amount: settings.birthdayGiftMarks,
    now,
  });
  if (settings.birthdayRoleId && reward.result === "recorded") {
    await grantSystemRole(db, {
      guildId,
      userId,
      roleId: settings.birthdayRoleId,
      source: "birthday",
      sourceId: String(year),
      kind: "temporary",
      expiresAt: new Date(now.getTime() + DAY_MS),
      now,
    });
  }
  if (birthday.announce && reward.result === "recorded" && settings.birthdayChannelId) {
    await enqueueOutbox(db, {
      guildId,
      eventType: "progression.birthday.announce",
      payload: { guildId, userId, greeting: settings.birthdayGreeting, channelId: settings.birthdayChannelId },
      idempotencyKey: `birthday-announce:${guildId}:${userId}:${year}`,
    });
  }
  return { result: reward.result, ledgerStatus: reward.ledgerStatus, role: settings.birthdayRoleId ? "scheduled" as const : "unset" as const };
}

export async function sweepBirthdays(db: PrismaClient, now: Date) {
  const rows = await db.birthdayRecord.findMany({ where: { deletedAt: null, month: { not: null }, day: { not: null } }, take: 50 });
  let changed = 0;
  for (const row of rows) {
    const result = await celebrateBirthday(db, row.guildId, row.userId, now);
    if (result.result === "recorded") {
      changed += 1;
    }
  }
  return { changed };
}

export async function givePeerCommendation(
  db: Writer,
  input: { guildId: string; fromUserId: string; toUserId: string; category: string; reason: string; now: Date },
) {
  const { settings } = await settingsOf(db, input.guildId);
  const since = new Date(input.now.getTime() - settings.peerCooldownHours * HOUR_MS);
  const pairSince = new Date(input.now.getTime() - settings.peerPairWindowDays * DAY_MS);
  const recentFromSender = await db.commendation.count({
    where: { guildId: input.guildId, fromUserId: input.fromUserId, kind: "peer", status: "active", createdAt: { gte: since } },
  });
  const pairCount = await db.commendation.count({
    where: { guildId: input.guildId, fromUserId: input.fromUserId, toUserId: input.toUserId, kind: "peer", status: "active", createdAt: { gte: pairSince } },
  });
  const decision = peerCommendationDecision({
    fromUserId: input.fromUserId,
    toUserId: input.toUserId,
    recentFromSender,
    pairCount,
    pairLimit: settings.peerPairLimit,
  });
  if (decision !== "allowed") {
    return { result: decision, currency: "none" as const };
  }
  if (!input.reason.trim() || !input.category.trim()) {
    throw new ProgressionError("A commendation needs a category and a reason.");
  }
  await db.commendation.create({
    data: {
      id: randomUUID(),
      guildId: input.guildId,
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      kind: "peer",
      category: input.category.trim(),
      reason: input.reason.trim(),
      status: "active",
    },
  });
  return { result: "recorded" as const, currency: "none" as const };
}

export async function giveStaffCommendation(
  db: Writer,
  input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; toUserId: string; category: string; reason: string },
) {
  const allowed = await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "moderation" });
  if (allowed === "denied") {
    return { result: "denied" as const };
  }
  if (!input.reason.trim()) {
    throw new ProgressionError("A commendation needs a reason.");
  }
  const id = randomUUID();
  await db.commendation.create({
    data: { id, guildId: input.guildId, fromUserId: input.actorUserId, toUserId: input.toUserId, kind: "staff", category: input.category.trim() || "staff", reason: input.reason.trim(), status: "active" },
  });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "progression.commendation",
    targetType: "commendation",
    targetId: id,
    reason: input.reason,
  });
  return { result: "recorded" as const, currency: "none" as const };
}

export async function removeCommendation(
  db: Writer,
  input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; commendationId: string; reason: string },
) {
  const allowed = await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "moderation" });
  if (allowed === "denied") {
    return { result: "denied" as const };
  }
  const row = await db.commendation.findUnique({ where: { id: input.commendationId } });
  if (!row || row.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  await db.commendation.update({ where: { id: row.id }, data: { status: "removed" } });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "progression.commendation.remove",
    targetType: "commendation",
    targetId: row.id,
    reason: input.reason,
  });
  return { result: "removed" as const, retained: true as const };
}

export async function updateDossierPreferences(
  db: Writer,
  input: { guildId: string; userId: string; bio?: string | null; bioPublic?: boolean; frame?: string | null; background?: string | null },
) {
  await ensureGuild(db, { guildId: input.guildId });
  await db.dossierProfile.upsert({
    where: { guildId_userId: { guildId: input.guildId, userId: input.userId } },
    create: {
      guildId: input.guildId,
      userId: input.userId,
      bio: input.bio ?? null,
      bioPublic: input.bioPublic ?? false,
      frame: input.frame ?? null,
      background: input.background ?? null,
    },
    update: {
      ...(input.bio !== undefined ? { bio: input.bio } : {}),
      ...(input.bioPublic !== undefined ? { bioPublic: input.bioPublic } : {}),
      ...(input.frame !== undefined ? { frame: input.frame } : {}),
      ...(input.background !== undefined ? { background: input.background } : {}),
    },
  });
  return { result: "saved" as const };
}

export async function readPublicDossier(db: Writer, guildId: string, userId: string) {
  const { settings } = await settingsOf(db, guildId);
  const progress = await db.memberProgression.findUnique({ where: { guildId_userId: { guildId, userId } } });
  const profile = await db.dossierProfile.findUnique({ where: { guildId_userId: { guildId, userId } } });
  const birthday = await db.birthdayRecord.findUnique({ where: { guildId_userId: { guildId, userId } } });
  const accounts = await db.linkedAccount.findMany({ where: { guildId, userId, visibility: "public", unlinkedAt: null } });
  const earned = await db.memberAchievement.findMany({ where: { guildId, userId } });
  const commendations = await db.commendation.findMany({ where: { guildId, toUserId: userId, status: "active" } });
  const characterRow = await db.playerCharacter.findUnique({ where: { guildId_userId: { guildId, userId } } });
  const characterClass = characterRow ? await db.classDefinition.findUnique({ where: { id: characterRow.classId } }) : null;
  const xp = progress?.xp ?? 0;
  const level = levelForXp(xp, settings.xpPerLevel);
  const band = bandForLevel(level, settings.rankBands);
  return publicDossier({
    userId,
    xp,
    level,
    rankName: band?.name ?? null,
    bio: profile?.bio ?? null,
    bioPublic: profile?.bioPublic ?? false,
    birthday: birthday && !birthday.deletedAt && birthday.month !== null && birthday.day !== null ? { month: birthday.month, day: birthday.day } : null,
    birthdayPublic: Boolean(birthday?.announce && !birthday.deletedAt),
    title: profile?.title ?? null,
    frame: profile?.frame ?? null,
    background: profile?.background ?? null,
    accounts: accounts.map((account) => ({ provider: account.provider, handle: account.handle })),
    achievements: settings.achievements.map((achievement) => ({
      id: achievement.id,
      name: achievement.name,
      hidden: achievement.hidden,
      earned: earned.some((row) => row.achievementId === achievement.id),
    })),
    commendations: commendations.map((row) => ({ category: row.category, reason: row.reason })),
    wallet: await readValuedWallet(db, guildId, userId),
    character: characterRow ? { status: "ready", className: characterClass?.name ?? characterRow.classSlug, level: characterRow.level } : { status: "uncreated" },
  });
}

export async function readPrivatePreferences(db: Writer, guildId: string, userId: string) {
  const profile = await db.dossierProfile.findUnique({ where: { guildId_userId: { guildId, userId } } });
  const birthday = await db.birthdayRecord.findUnique({ where: { guildId_userId: { guildId, userId } } });
  return {
    bio: profile?.bio ?? null,
    bioPublic: profile?.bioPublic ?? false,
    frame: profile?.frame ?? null,
    background: profile?.background ?? null,
    birthday: birthday && !birthday.deletedAt ? { month: birthday.month, day: birthday.day, year: birthday.year, announce: birthday.announce } : null,
    wallet: await readValuedWallet(db, guildId, userId),
  };
}
