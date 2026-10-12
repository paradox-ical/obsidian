import { randomUUID } from "node:crypto";

import { exampleProgressionSettings, exampleSeasonSettings } from "@collective/domain";
import { afterAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";
import { grantCapability } from "./platform.js";
import { recordChatActivity, saveProgressionSettings } from "./progression.js";
import {
  cleanupRoom,
  closeRoom,
  createPoll,
  createRoom,
  deliverRoomChannel,
  noteRoomMessage,
  noteRoomPresence,
  readLeaderboard,
  readPollResults,
  readSeasonArchive,
  recordSeal,
  rollSeason,
  saveSeasonSettings,
  setRoomHold,
  sweepRoomCleanup,
  votePoll,
} from "./seasons.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const now = new Date("2026-10-10T02:00:00.000Z");
const hour = 60 * 60 * 1000;

afterAll(async () => {
  await db.job.deleteMany({ where: { guildId } });
  await db.outboxMessage.deleteMany({ where: { guildId } });
  await db.pollVote.deleteMany({ where: { guildId } });
  await db.pollChoice.deleteMany({ where: { guildId } });
  await db.poll.deleteMany({ where: { guildId } });
  await db.tempRoom.deleteMany({ where: { guildId } });
  await db.seasonArchive.deleteMany({ where: { guildId } });
  await db.seasonalScore.deleteMany({ where: { guildId } });
  await db.lifetimeScore.deleteMany({ where: { guildId } });
  await db.seasonState.deleteMany({ where: { guildId } });
  await db.seasonSettings.deleteMany({ where: { guildId } });
  await db.marketTrade.deleteMany({ where: { guildId } });
  await db.marketQuote.deleteMany({ where: { guildId } });
  await db.collapseCharge.deleteMany({ where: { guildId } });
  await db.ingotMarket.deleteMany({ where: { guildId } });
  await db.ledgerEntry.deleteMany({ where: { guildId } });
  await db.wallet.deleteMany({ where: { guildId } });
  await db.issuanceBudget.deleteMany({ where: { guildId } });
  await db.economySettings.deleteMany({ where: { guildId } });
  await db.rewardEvent.deleteMany({ where: { guildId } });
  await db.memberAchievement.deleteMany({ where: { guildId } });
  await db.memberProgression.deleteMany({ where: { guildId } });
  await db.roleEntitlement.deleteMany({ where: { guildId } });
  await db.progressionSettings.deleteMany({ where: { guildId } });
  await db.auditRecord.deleteMany({ where: { guildId } });
  await db.capabilityGrant.deleteMany({ where: { guildId } });
  await db.guild.deleteMany({ where: { guildId } });
  await db.$disconnect();
});

describe("seasons, leaderboards, polls, and temporary rooms", () => {
  it("archives a season once, keeps progression and wallets, and leaves characters pending", async () => {
    const progression = exampleProgressionSettings();
    await saveSeasonSettings(db, { guildId, actorUserId: "owner", reason: "Publish the season calendar", settings: exampleSeasonSettings() });
    await saveProgressionSettings(db, {
      guildId,
      actorUserId: "owner",
      reason: "Publish a short XP curve",
      settings: { ...progression, messageXp: 20, messageCooldownSeconds: 0, repeatWindowSeconds: 0, minimumMessageLength: 4, dailyMessageXp: 500 },
    });
    await recordChatActivity(db, { guildId, userId: "alpha", channelId: "general", content: "alpha one", now });
    await recordChatActivity(db, { guildId, userId: "alpha", channelId: "general", content: "alpha two", now });
    await recordChatActivity(db, { guildId, userId: "beta", channelId: "general", content: "beta line", now });
    await recordChatActivity(db, { guildId, userId: "treasury", channelId: "general", content: "treasury line", now });
    const before = await db.memberProgression.findUnique({ where: { guildId_userId: { guildId, userId: "alpha" } } });
    expect(before?.xp).toBeGreaterThan(0);
    await recordSeal(db, { guildId, userId: "alpha", amount: 5, now });
    await recordSeal(db, { guildId, userId: "beta", amount: 1, now });

    const board = await readLeaderboard(db, { guildId, category: "community_xp", page: 1, pageSize: 1, viewerId: "beta", now });
    expect(board).toMatchObject({ result: "ready", ownPosition: 2 });
    if (board.result === "ready") {
      expect(board.rows[0]?.userId).toBe("alpha");
    }
    expect(await readLeaderboard(db, { guildId, category: "marks", viewerId: "beta", now })).toMatchObject({ result: "ready", availability: "available", rows: [] });
    expect(await readLeaderboard(db, { guildId, category: "estimated_wealth", viewerId: "beta", now })).toMatchObject({
      result: "ready",
      label: "estimated",
      priceSensitive: true,
      availability: "available",
    });

    const state = await db.seasonState.findUnique({ where: { guildId } });
    const seasonId = state?.seasonId ?? "";
    const rolled = await rollSeason(db, { guildId, now: state?.endsAt ?? now, actorUserId: "owner", reason: "Close the season" });
    expect(rolled.result).toBe("rolled");
    if (rolled.result !== "rolled") {
      return;
    }
    expect(rolled.award).toMatchObject({ userId: "alpha", title: "recorded", marks: "recorded" });
    expect(rolled.preservation.character).toEqual({ status: "retained", retained: true });
    expect(rolled.preservation.gear).toEqual({ status: "retained", retained: true });
    expect(rolled.preservation.ranked).toEqual({ status: "reset", retained: true });
    expect(rolled.preservation.wallet).toEqual({ status: "retained", retained: true });
    expect(rolled.wallet.marks).toMatchObject({ status: "available", available: "100.00" });
    expect(rolled.wallet.ingots).toMatchObject({ status: "available", available: "0" });
    expect(rolled.preservation.communityXp).toBe("retained");
    expect(rolled.preservation.seasonalSeals).toBe("reset");

    const after = await db.memberProgression.findUnique({ where: { guildId_userId: { guildId, userId: "alpha" } } });
    expect(after?.xp).toBe(before?.xp);
    expect(await db.lifetimeScore.findUnique({ where: { guildId_userId: { guildId, userId: "alpha" } } })).toMatchObject({ seals: 5 });
    expect(await db.seasonalScore.findUnique({ where: { guildId_userId_seasonId: { guildId, userId: "alpha", seasonId } } })).toMatchObject({ seals: 5 });
    expect(await db.seasonalScore.findUnique({ where: { guildId_userId_seasonId: { guildId, userId: "alpha", seasonId: rolled.nextSeasonId } } })).toBeNull();

    const archive = await readSeasonArchive(db, { guildId, seasonId, category: "community_xp", viewerId: "alpha" });
    expect(archive.result).toBe("ready");
    if (archive.result === "ready") {
      expect(archive.rows.some((row) => row.userId === "alpha")).toBe(true);
      expect(archive.rows.some((row) => row.userId === "treasury")).toBe(false);
    }
    expect(await readSeasonArchive(db, { guildId, seasonId, category: "pvp", viewerId: "alpha" })).toMatchObject({ result: "ready", availability: "available" });

    const again = await rollSeason(db, { guildId, now: state?.endsAt ?? now, actorUserId: "owner", reason: "Close the season again" });
    expect(again.result).toBe("not_due");
    expect(await db.rewardEvent.count({ where: { guildId, source: "season" } })).toBe(2);
    expect(await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId, userId: "alpha", currency: "marks" } } })).toMatchObject({ availableMinor: 10000n });
  });

  it("refuses member poll creation, ineligible votes, and suggestions", async () => {
    const opensAt = now;
    const closesAt = new Date(now.getTime() + 24 * hour);
    const denied = await createPoll(db, {
      guildId,
      actorUserId: "member",
      actorRoleIds: [],
      question: "Should we?",
      choices: ["Yes", "No"],
      mode: "single",
      kind: "poll",
      anonymous: true,
      eligibleRoleIds: ["voters"],
      opensAt,
      closesAt,
      now,
      reason: "A member tried to open a poll",
    });
    expect(denied.result).toBe("denied");
    expect(await db.poll.count({ where: { guildId } })).toBe(0);

    await grantCapability(db, { guildId, roleId: "staff", capability: "event_management", actorUserId: "owner", reason: "Allow staff polls" });
    const suggestion = await createPoll(db, {
      guildId,
      actorUserId: "staff-user",
      actorRoleIds: ["staff"],
      question: "Suggestion box",
      choices: ["Yes", "No"],
      mode: "single",
      kind: "suggestion",
      anonymous: false,
      eligibleRoleIds: [],
      opensAt,
      closesAt,
      now,
      reason: "Try to open suggestions",
    });
    expect(suggestion.result).toBe("excluded");
    expect(await db.poll.count({ where: { guildId } })).toBe(0);

    const created = await createPoll(db, {
      guildId,
      actorUserId: "staff-user",
      actorRoleIds: ["staff"],
      question: "Ship the season?",
      choices: ["Yes", "No"],
      mode: "single",
      kind: "poll",
      anonymous: true,
      eligibleRoleIds: ["voters"],
      opensAt,
      closesAt,
      now,
      reason: "Open a staff poll",
    });
    expect(created.result).toBe("created");
    if (created.result !== "created") {
      return;
    }
    const choiceId = created.choices[0]?.id ?? "";
    expect(await votePoll(db, { guildId, pollId: created.pollId, userId: "member", roleIds: [], choiceId, now })).toMatchObject({ result: "ineligible" });
    expect(await db.pollVote.count({ where: { pollId: created.pollId } })).toBe(0);
    expect(await votePoll(db, { guildId, pollId: created.pollId, userId: "member", roleIds: ["voters"], choiceId, now })).toMatchObject({ result: "voted" });
    const memberView = await readPollResults(db, { guildId, pollId: created.pollId, audience: "member" });
    const staffView = await readPollResults(db, { guildId, pollId: created.pollId, audience: "staff" });
    if (memberView.result === "ready" && staffView.result === "ready") {
      expect(memberView.counts[0]?.voterIds).toEqual([]);
      expect(staffView.counts[0]?.voterIds).toEqual(["member"]);
    }
    expect(await db.pollVote.findFirst({ where: { pollId: created.pollId } })).toMatchObject({ userId: "member" });
  });

  it("keeps room timers across restart, ignores bot text, and transfers ownership", async () => {
    await saveSeasonSettings(db, {
      guildId,
      actorUserId: "owner",
      reason: "Publish room caps",
      settings: { ...exampleSeasonSettings(), memberRoomCap: 1, serverRoomCap: 5, roomCooldownMinutes: 10 },
    });
    const voice = await createRoom(db, { guildId, userId: "owner", kind: "voice", name: "raid", privacy: "public", now });
    expect(voice.result).toBe("created");
    if (voice.result !== "created") {
      return;
    }
    const createdVoice = await db.tempRoom.findUnique({ where: { id: voice.roomId } });
    const voiceJob = await db.job.findFirst({ where: { guildId, jobType: "room.voice.cleanup", idempotencyKey: `room-voice:${voice.roomId}:${createdVoice?.emptySince?.toISOString()}` } });
    expect(voiceJob?.status).toBe("pending");
    expect(voiceJob?.runAt.toISOString()).toBe(new Date((createdVoice?.emptySince?.getTime() ?? 0) + 6 * hour).toISOString());
    expect(await createRoom(db, { guildId, userId: "owner", kind: "text", name: "notes", now: new Date(now.getTime() + 1000) })).toMatchObject({ result: "cooldown" });

    const text = await createRoom(db, { guildId, userId: "owner", kind: "text", name: "notes", now: new Date(now.getTime() + 11 * 60 * 1000) });
    expect(text.result).toBe("created");
    if (text.result !== "created") {
      return;
    }
    expect(text.privacy).toBe("private");
    expect(await createRoom(db, { guildId, userId: "owner", kind: "voice", name: "second", now: new Date(now.getTime() + 21 * 60 * 1000) })).toMatchObject({ result: "member_cap" });
    expect(await noteRoomPresence(db, { guildId, roomId: text.roomId, userId: "stranger", roleIds: [], action: "join", now })).toMatchObject({ result: "denied" });
    await grantCapability(db, { guildId, roleId: "mods", capability: "moderation", actorUserId: "owner", reason: "Allow room moderation" });
    expect(await noteRoomPresence(db, { guildId, roomId: text.roomId, userId: "mod", roleIds: ["mods"], action: "join", now })).toMatchObject({ result: "joined" });

    const textRoom = await db.tempRoom.findUnique({ where: { id: text.roomId } });
    const beforeJobs = (await db.job.findMany({ where: { guildId, jobType: "room.text.cleanup" } })).map((job) => job.idempotencyKey);
    const botAt = new Date((textRoom?.lastHumanAt.getTime() ?? now.getTime()) + 23 * hour);
    expect(await noteRoomMessage(db, { guildId, roomId: text.roomId, authorKind: "bot", now: botAt })).toMatchObject({ result: "ignored" });
    expect(await db.tempRoom.findUnique({ where: { id: text.roomId } })).toMatchObject({ lastHumanAt: textRoom?.lastHumanAt });
    expect((await db.job.findMany({ where: { guildId, jobType: "room.text.cleanup" } })).map((job) => job.idempotencyKey)).toEqual(beforeJobs);
    expect(await cleanupRoom(db, text.roomId, botAt)).toMatchObject({ result: "waiting" });
    expect(await noteRoomMessage(db, { guildId, roomId: text.roomId, authorKind: "human", now: botAt })).toMatchObject({ result: "recorded" });
    expect(await cleanupRoom(db, text.roomId, new Date((textRoom?.lastHumanAt.getTime() ?? now.getTime()) + 24 * hour))).toMatchObject({ result: "waiting" });
    await db.tempRoom.update({ where: { id: text.roomId }, data: { createdAt: new Date(now.getTime() - 400 * 24 * hour) } });
    expect(await cleanupRoom(db, text.roomId, new Date(botAt.getTime() + hour))).toMatchObject({ result: "waiting", status: "open" });
    expect(await setRoomHold(db, { guildId, roomId: text.roomId, reason: "event", actorRoleIds: ["mods"] })).toMatchObject({ result: "not_exempt" });

    const due = new Date(now.getTime() + 6 * hour + 1000);
    expect(await noteRoomPresence(db, { guildId, roomId: voice.roomId, userId: "owner", roleIds: [], action: "join", now: due })).toMatchObject({ result: "joined" });
    expect(await cleanupRoom(db, voice.roomId, due)).toMatchObject({ result: "occupied", status: "open" });
    expect(await db.tempRoom.findUnique({ where: { id: voice.roomId } })).toMatchObject({ emptySince: null, status: "open" });
    expect(await noteRoomPresence(db, { guildId, roomId: voice.roomId, userId: "guest", roleIds: [], action: "join", now: due })).toMatchObject({ result: "joined" });
    expect(await noteRoomPresence(db, { guildId, roomId: voice.roomId, userId: "owner", roleIds: [], action: "leave", now: due })).toMatchObject({ result: "left", ownerUserId: "guest" });
    const manual = await closeRoom(db, { guildId, roomId: voice.roomId, actorUserId: "guest", actorRoleIds: [], now: due });
    expect(manual).toMatchObject({ result: "closed", warnDisconnect: true, disconnectState: "setup_required" });
    if (manual.result === "closed") {
      expect(manual.occupants).toContain("guest");
    }

    const replacement = await createRoom(db, { guildId, userId: "owner", kind: "voice", name: "later", now: due });
    expect(replacement.result).toBe("created");
    if (replacement.result !== "created") {
      return;
    }
    const restart = new Date(due.getTime() + 7 * hour);
    const persisted = await db.job.findFirst({ where: { guildId, jobType: "room.voice.cleanup", idempotencyKey: { contains: replacement.roomId } } });
    expect(persisted?.status).toBe("pending");
    await db.job.deleteMany({ where: { id: persisted?.id ?? "" } });
    await db.tempRoom.update({ where: { id: replacement.roomId }, data: { emptySince: new Date(restart.getTime() - 7 * hour) } });
    expect((await sweepRoomCleanup(db, restart)).queued).toBe(1);
    const recovered = await db.job.findFirst({ where: { guildId, jobType: "room.voice.cleanup", idempotencyKey: { contains: replacement.roomId } }, orderBy: { createdAt: "desc" } });
    expect(recovered?.status).toBe("pending");
    expect((recovered?.runAt.getTime() ?? Number.MAX_SAFE_INTEGER) <= restart.getTime()).toBe(true);
    expect(await cleanupRoom(db, replacement.roomId, restart)).toMatchObject({ result: "closed", disconnectState: "not_applicable" });
    expect(await db.rewardEvent.count({ where: { guildId, source: "room" } })).toBe(0);
    await expect(deliverRoomChannel(db, { roomId: text.roomId, action: "open" }, async () => ({ outcome: "setup_required" as const }))).rejects.toThrow(/setup_required/);
    expect(await db.tempRoom.findUnique({ where: { id: text.roomId } })).toMatchObject({ channelId: null, status: "open" });
  });
});
