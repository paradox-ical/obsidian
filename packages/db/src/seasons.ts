import { randomUUID } from "node:crypto";

import {
  LEADERBOARD_CATEGORIES,
  applyRoomMessage,
  applyVoicePresence,
  cleanupDecision,
  exampleSeasonSettings,
  holdDecision,
  isLeaderboardCategory,
  leaderboardView,
  manualClosePlan,
  pollCreateDecision,
  prepareSeasonSettings,
  preservationManifest,
  presentPollResults,
  rankStandings,
  readPublicWallet,
  roomAccess,
  roomCreateDecision,
  seasonWindow,
  transferOwner,
  voteDecision,
  type LeaderboardCategory,
  type RoomPrivacy,
  type SeasonSettingsInput,
  type Standing,
} from "@collective/domain";
import type { Prisma } from "../generated/prisma/client.js";

import { marksLeaderboardRows, readMemberWallet } from "./ledger.js";
import { ingotLeaderboardRows, wealthLeaderboardRows } from "./market.js";
import { actorCan, enqueueJob, enqueueOutbox, ensureGuild, moduleIsAvailable, writeAudit, type Writer } from "./platform.js";
import { recordSharedReward } from "./progression.js";

const HOUR_MS = 60 * 60 * 1000;

export class SeasonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeasonError";
  }
}

function asSettings(value: unknown): SeasonSettingsInput | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const settings = value as SeasonSettingsInput;
  if (typeof settings.startMonth !== "number" || !Array.isArray(settings.systemUserIds)) {
    return null;
  }
  return settings;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function settingsOf(db: Writer, guildId: string) {
  await ensureGuild(db, { guildId });
  const row = await db.seasonSettings.findUnique({ where: { guildId } });
  if (!row) {
    const settings = exampleSeasonSettings();
    await db.seasonSettings.create({
      data: { guildId, version: 1, label: settings.label, document: json(settings) },
    });
    return { version: 1, settings };
  }
  const settings = asSettings(row.document);
  if (!settings) {
    throw new SeasonError("Stored season settings are unreadable.");
  }
  return { version: row.version, settings: prepareSeasonSettings(settings) };
}

export async function readSeasonSettings(db: Writer, guildId: string) {
  const stored = await db.seasonSettings.findUnique({ where: { guildId } });
  if (!stored) {
    return { stored: false as const, version: 0, settings: exampleSeasonSettings(), preservation: preservationManifest(), wallet: readPublicWallet() };
  }
  const settings = asSettings(stored.document);
  if (!settings) {
    throw new SeasonError("Stored season settings are unreadable.");
  }
  return { stored: true as const, version: stored.version, settings: prepareSeasonSettings(settings), preservation: preservationManifest(), wallet: readPublicWallet() };
}

export async function saveSeasonSettings(
  db: Writer,
  input: { guildId: string; settings: SeasonSettingsInput; actorUserId: string; reason: string },
) {
  await ensureGuild(db, { guildId: input.guildId });
  const settings = prepareSeasonSettings(input.settings);
  const current = await db.seasonSettings.findUnique({ where: { guildId: input.guildId } });
  const version = (current?.version ?? 0) + 1;
  await db.seasonSettings.upsert({
    where: { guildId: input.guildId },
    create: { guildId: input.guildId, version, label: settings.label, document: json(settings) },
    update: { version, label: settings.label, document: json(settings) },
  });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "season.settings",
    targetType: "season_settings",
    targetId: input.guildId,
    reason: input.reason,
  });
  return { version, settings, preservation: preservationManifest(), wallet: readPublicWallet() };
}

export async function ensureSeason(db: Writer, guildId: string, now: Date) {
  const { settings } = await settingsOf(db, guildId);
  const current = await db.seasonState.findUnique({ where: { guildId } });
  if (current) {
    return { settings, state: current };
  }
  const window = seasonWindow(now, settings.startMonth, settings.timezone);
  try {
    const state = await db.seasonState.create({
      data: { guildId, seasonId: window.id, startsAt: window.startsAt, endsAt: window.endsAt },
    });
    await enqueueJob(db, {
      guildId,
      jobType: "season.rollover",
      payload: { guildId, seasonId: window.id },
      idempotencyKey: `season-rollover:${guildId}:${window.id}`,
      runAt: window.endsAt,
    });
    return { settings, state };
  } catch (error) {
    if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002") {
      throw error;
    }
    const state = await db.seasonState.findUnique({ where: { guildId } });
    if (!state) {
      throw error;
    }
    return { settings, state };
  }
}

async function standingRows(db: Writer, guildId: string, seasonId: string, category: LeaderboardCategory): Promise<Standing[]> {
  if (category === "community_xp") {
    const rows = await db.memberProgression.findMany({ where: { guildId } });
    return rows.map((row) => ({ userId: row.userId, score: row.xp }));
  }
  if (category === "seasonal_seals") {
    const rows = await db.seasonalScore.findMany({ where: { guildId, seasonId } });
    return rows.map((row) => ({ userId: row.userId, score: row.seals }));
  }
  if (category === "lifetime_seals") {
    const rows = await db.lifetimeScore.findMany({ where: { guildId } });
    return rows.map((row) => ({ userId: row.userId, score: row.seals }));
  }
  if (category === "marks") {
    return marksLeaderboardRows(db, guildId);
  }
  if (category === "ingots") {
    return ingotLeaderboardRows(db, guildId);
  }
  if (category === "estimated_wealth") {
    return wealthLeaderboardRows(db, guildId);
  }
  if (category === "pvp") {
    const rows = await db.pvpRating.findMany({ where: { guildId, seasonId } });
    return rows.map((row) => ({ userId: row.userId, score: row.rating }));
  }
  if (category === "recruitment") {
    const rows = await db.rewardEvent.findMany({ where: { guildId, source: "recruitment", status: "recorded" } });
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.userId, (counts.get(row.userId) ?? 0) + 1);
    }
    return [...counts].map(([userId, score]) => ({ userId, score }));
  }
  return [];
}

export async function recordSeal(db: Writer, input: { guildId: string; userId: string; amount: number; now: Date }) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return { result: "invalid" as const };
  }
  const { state } = await ensureSeason(db, input.guildId, input.now);
  const seasonal = await db.seasonalScore.upsert({
    where: { guildId_userId_seasonId: { guildId: input.guildId, userId: input.userId, seasonId: state.seasonId } },
    create: { guildId: input.guildId, userId: input.userId, seasonId: state.seasonId, seals: input.amount },
    update: { seals: { increment: input.amount } },
  });
  const lifetime = await db.lifetimeScore.upsert({
    where: { guildId_userId: { guildId: input.guildId, userId: input.userId } },
    create: { guildId: input.guildId, userId: input.userId, seals: input.amount },
    update: { seals: { increment: input.amount } },
  });
  return { result: "recorded" as const, seasonId: state.seasonId, seasonal: seasonal.seals, lifetime: lifetime.seals };
}

export async function rollSeason(db: Writer, input: { guildId: string; now: Date; actorUserId: string; reason: string }) {
  const { settings, state } = await ensureSeason(db, input.guildId, input.now);
  const preservation = preservationManifest();
  if (input.now.getTime() < state.endsAt.getTime()) {
    return { result: "not_due" as const, seasonId: state.seasonId, endsAt: state.endsAt, preservation, wallet: readPublicWallet() };
  }
  const snapshots = new Map<LeaderboardCategory, Standing[]>();
  for (const category of LEADERBOARD_CATEGORIES) {
    const view = leaderboardView(category);
    const rows = view.availability === "available" ? await standingRows(db, input.guildId, state.seasonId, category) : [];
    snapshots.set(category, rows);
    const already = await db.seasonArchive.findUnique({
      where: { guildId_seasonId_category: { guildId: input.guildId, seasonId: state.seasonId, category } },
    });
    if (already) {
      continue;
    }
    try {
      await db.seasonArchive.create({
        data: {
          id: randomUUID(),
          guildId: input.guildId,
          seasonId: state.seasonId,
          category,
          availability: view.availability,
          standings: json(rows),
          preservation: json(preservation),
        },
      });
    } catch (error) {
      if (!isUnique(error)) {
        throw error;
      }
    }
  }
  const seals = rankStandings(snapshots.get("seasonal_seals") ?? [], settings.systemUserIds, 1, 1, "").rows;
  const winner = seals[0];
  let award: { userId: string; title: string; marks: string } | null = null;
  if (winner && winner.score > 0) {
    const title = await recordSharedReward(db, {
      guildId: input.guildId,
      userId: winner.userId,
      source: "season",
      sourceId: `${state.seasonId}:title:1`,
      kind: "title",
      amount: null,
      now: input.now,
    });
    const marks = await recordSharedReward(db, {
      guildId: input.guildId,
      userId: winner.userId,
      source: "season",
      sourceId: `${state.seasonId}:marks:1`,
      kind: "marks",
      amount: settings.awardMarks,
      now: input.now,
    });
    award = { userId: winner.userId, title: title.result, marks: marks.result };
  }
  const next = seasonWindow(state.endsAt, settings.startMonth, settings.timezone);
  await db.seasonState.update({
    where: { guildId: input.guildId },
    data: { seasonId: next.id, startsAt: next.startsAt, endsAt: next.endsAt, rolledFrom: state.seasonId },
  });
  await enqueueJob(db, {
    guildId: input.guildId,
    jobType: "season.rollover",
    payload: { guildId: input.guildId, seasonId: next.id },
    idempotencyKey: `season-rollover:${input.guildId}:${next.id}`,
    runAt: next.endsAt,
  });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "season.rollover",
    targetType: "season",
    targetId: state.seasonId,
    reason: input.reason,
  });
  const wallet = award ? await readMemberWallet(db, input.guildId, award.userId) : readPublicWallet();
  return { result: "rolled" as const, seasonId: state.seasonId, nextSeasonId: next.id, award, preservation, wallet };
}

export async function sweepSeasonRollover(db: Writer, now: Date) {
  const due = await db.seasonState.findMany({ where: { endsAt: { lte: now } } });
  let queued = 0;
  for (const state of due) {
    const queuedJob = await enqueueJob(db, {
      guildId: state.guildId,
      jobType: "season.rollover",
      payload: { guildId: state.guildId, seasonId: state.seasonId },
      idempotencyKey: `season-rollover:${state.guildId}:${state.seasonId}`,
      runAt: state.endsAt,
    });
    if (queuedJob.created) {
      queued += 1;
    }
  }
  return { queued };
}

export async function readLeaderboard(
  db: Writer,
  input: { guildId: string; category: string; page?: number; pageSize?: number; viewerId: string; now: Date },
) {
  if (!isLeaderboardCategory(input.category)) {
    return { result: "invalid" as const };
  }
  const view = leaderboardView(input.category);
  const { settings, state } = await ensureSeason(db, input.guildId, input.now);
  if (view.availability !== "available") {
    return {
      result: "pending" as const,
      category: input.category,
      seasonId: state.seasonId,
      ...view,
      rows: [],
      ownPosition: null,
      ownScore: null,
      total: 0,
      page: 1,
      pageSize: input.pageSize ?? 10,
      wallet: readPublicWallet(),
    };
  }
  const rows = await standingRows(db, input.guildId, state.seasonId, input.category);
  const page = rankStandings(rows, settings.systemUserIds, input.page ?? 1, input.pageSize ?? 10, input.viewerId);
  return { result: "ready" as const, category: input.category, seasonId: state.seasonId, ...view, ...page, wallet: readPublicWallet() };
}

export async function readSeasonArchive(
  db: Writer,
  input: { guildId: string; seasonId: string; category: string; page?: number; pageSize?: number; viewerId: string },
) {
  if (!isLeaderboardCategory(input.category)) {
    return { result: "invalid" as const };
  }
  const row = await db.seasonArchive.findUnique({
    where: { guildId_seasonId_category: { guildId: input.guildId, seasonId: input.seasonId, category: input.category } },
  });
  if (!row) {
    return { result: "missing" as const, seasonId: input.seasonId, category: input.category };
  }
  const view = leaderboardView(input.category);
  const stored = Array.isArray(row.standings) ? (row.standings as unknown as Standing[]) : [];
  const settings = await settingsOf(db, input.guildId);
  if (view.availability !== "available") {
    return { result: "pending" as const, category: input.category, seasonId: input.seasonId, ...view, rows: [], ownPosition: null, preservation: row.preservation };
  }
  const page = rankStandings(stored, settings.settings.systemUserIds, input.page ?? 1, input.pageSize ?? 10, input.viewerId);
  return { result: "ready" as const, category: input.category, seasonId: input.seasonId, ...view, ...page, preservation: row.preservation };
}

export async function createPoll(
  db: Writer,
  input: {
    guildId: string;
    actorUserId: string;
    actorRoleIds: readonly string[];
    question: string;
    choices: readonly string[];
    mode: string;
    kind: string;
    anonymous: boolean;
    eligibleRoleIds: readonly string[];
    opensAt: Date;
    closesAt: Date;
    now: Date;
    reason: string;
  },
) {
  const decision = pollCreateDecision({
    allowed: (await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "event_management" })) === "allowed",
    kind: input.kind,
    moduleAvailable: await moduleIsAvailable(db, input.guildId, "polls"),
  });
  if (decision !== "allowed") {
    return { result: decision };
  }
  const question = input.question.trim();
  const choices = [...new Set(input.choices.map((choice) => choice.trim()).filter((choice) => choice.length > 0))];
  if (question.length < 1 || choices.length < 2 || (input.mode !== "single" && input.mode !== "multiple") || input.closesAt.getTime() <= input.opensAt.getTime()) {
    return { result: "invalid" as const };
  }
  await ensureGuild(db, { guildId: input.guildId });
  const id = randomUUID();
  const status = input.now.getTime() < input.opensAt.getTime() ? "scheduled" : "open";
  await db.poll.create({
    data: {
      id,
      guildId: input.guildId,
      question,
      mode: input.mode,
      anonymous: input.anonymous,
      eligibleRoleIds: json([...input.eligibleRoleIds]),
      opensAt: input.opensAt,
      closesAt: input.closesAt,
      status,
      createdBy: input.actorUserId,
    },
  });
  const storedChoices = [];
  for (let index = 0; index < choices.length; index += 1) {
    const label = choices[index] ?? "";
    const choiceId = randomUUID();
    await db.pollChoice.create({ data: { id: choiceId, pollId: id, guildId: input.guildId, label, position: index } });
    storedChoices.push({ id: choiceId, label });
  }
  await enqueueJob(db, {
    guildId: input.guildId,
    jobType: "poll.close",
    payload: { pollId: id },
    idempotencyKey: `poll-close:${id}`,
    runAt: input.closesAt,
  });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "poll.create",
    targetType: "poll",
    targetId: id,
    reason: input.reason,
  });
  return { result: "created" as const, pollId: id, status, choices: storedChoices, suggestions: "excluded" as const };
}

export async function votePoll(db: Writer, input: { guildId: string; pollId: string; userId: string; roleIds: readonly string[]; choiceId: string; now: Date }) {
  const poll = await db.poll.findUnique({ where: { id: input.pollId } });
  if (!poll || poll.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  if (!(await moduleIsAvailable(db, input.guildId, "polls"))) {
    return { result: "maintenance" as const };
  }
  const decision = voteDecision({
    status: poll.status,
    opensAt: poll.opensAt,
    closesAt: poll.closesAt,
    now: input.now,
    eligibleRoleIds: stringList(poll.eligibleRoleIds),
    voterRoleIds: input.roleIds,
  });
  if (decision !== "allowed") {
    return { result: decision };
  }
  const choice = await db.pollChoice.findUnique({ where: { id: input.choiceId } });
  if (!choice || choice.pollId !== poll.id) {
    return { result: "unknown_choice" as const };
  }
  if (poll.mode === "single") {
    await db.pollVote.deleteMany({ where: { pollId: poll.id, userId: input.userId } });
  }
  try {
    await db.pollVote.create({
      data: { id: randomUUID(), pollId: poll.id, guildId: poll.guildId, userId: input.userId, choiceId: choice.id, createdAt: input.now },
    });
  } catch (error) {
    if (isUnique(error)) {
      return { result: "already_voted" as const };
    }
    throw error;
  }
  return { result: "voted" as const, pollId: poll.id };
}

export async function readPollResults(db: Writer, input: { guildId: string; pollId: string; audience: "member" | "staff" }) {
  const poll = await db.poll.findUnique({ where: { id: input.pollId } });
  if (!poll || poll.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  const choices = await db.pollChoice.findMany({ where: { pollId: poll.id }, orderBy: { position: "asc" } });
  const votes = await db.pollVote.findMany({ where: { pollId: poll.id } });
  return {
    result: "ready" as const,
    pollId: poll.id,
    question: poll.question,
    mode: poll.mode,
    status: poll.status,
    ...presentPollResults({
      anonymous: poll.anonymous,
      audience: input.audience,
      choices,
      votes,
    }),
  };
}

export async function closePoll(db: Writer, pollId: string, now: Date, status: "closed" | "cancelled" = "closed") {
  const poll = await db.poll.findUnique({ where: { id: pollId } });
  if (!poll) {
    return { result: "missing" as const };
  }
  if (poll.status === "closed" || poll.status === "cancelled") {
    return { result: "already_closed" as const, status: poll.status };
  }
  if (status === "closed" && now.getTime() < poll.closesAt.getTime()) {
    return { result: "waiting" as const };
  }
  await db.poll.update({ where: { id: poll.id }, data: { status } });
  return { result: status };
}

export async function cancelPoll(db: Writer, input: { guildId: string; pollId: string; actorUserId: string; actorRoleIds: readonly string[]; reason: string; now: Date }) {
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "event_management" })) !== "allowed") {
    return { result: "denied" as const };
  }
  const poll = await db.poll.findUnique({ where: { id: input.pollId } });
  if (!poll || poll.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  const closed = await closePoll(db, poll.id, input.now, "cancelled");
  if (closed.result === "cancelled") {
    await writeAudit(db, {
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      action: "poll.cancel",
      targetType: "poll",
      targetId: poll.id,
      reason: input.reason,
    });
  }
  return closed;
}

export async function listPolls(db: Writer, guildId: string) {
  const polls = await db.poll.findMany({ where: { guildId }, orderBy: { createdAt: "desc" } });
  return { suggestions: "excluded" as const, polls };
}

export async function sweepPollClose(db: Writer, now: Date) {
  const due = await db.poll.findMany({ where: { status: { in: ["open", "scheduled"] }, closesAt: { lte: now } } });
  let queued = 0;
  for (const poll of due) {
    const queuedJob = await enqueueJob(db, {
      guildId: poll.guildId,
      jobType: "poll.close",
      payload: { pollId: poll.id },
      idempotencyKey: `poll-close:${poll.id}`,
      runAt: poll.closesAt,
    });
    if (queuedJob.created) {
      queued += 1;
    }
  }
  return { queued };
}

async function roomRecord(db: Writer, roomId: string) {
  return db.tempRoom.findUnique({ where: { id: roomId } });
}

async function scheduleRoom(db: Writer, room: { id: string; guildId: string; kind: string; emptySince: Date | null; lastHumanAt: Date }) {
  if (room.kind === "voice") {
    if (!room.emptySince) {
      return;
    }
    await enqueueJob(db, {
      guildId: room.guildId,
      jobType: "room.voice.cleanup",
      payload: { roomId: room.id },
      idempotencyKey: `room-voice:${room.id}:${room.emptySince.toISOString()}`,
      runAt: new Date(room.emptySince.getTime() + 6 * HOUR_MS),
    });
    return;
  }
  await enqueueJob(db, {
    guildId: room.guildId,
    jobType: "room.text.cleanup",
    payload: { roomId: room.id },
    idempotencyKey: `room-text:${room.id}:${room.lastHumanAt.toISOString()}`,
    runAt: new Date(room.lastHumanAt.getTime() + 24 * HOUR_MS),
  });
}

export async function createRoom(
  db: Writer,
  input: { guildId: string; userId: string; kind: string; name: string; privacy?: RoomPrivacy; now: Date },
) {
  if (input.kind !== "voice" && input.kind !== "text") {
    return { result: "invalid" as const };
  }
  const name = input.name.trim();
  if (name.length < 1 || name.length > 80) {
    return { result: "invalid" as const };
  }
  const { settings } = await settingsOf(db, input.guildId);
  const open = await db.tempRoom.findMany({ where: { guildId: input.guildId, status: "open", kind: input.kind } });
  const mine = open.filter((room) => room.ownerUserId === input.userId);
  const latest = await db.tempRoom.findFirst({ where: { guildId: input.guildId, ownerUserId: input.userId }, orderBy: { createdAt: "desc" } });
  const decision = roomCreateDecision({
    memberOpen: mine.length,
    serverOpen: open.length,
    memberCap: settings.memberRoomCap,
    serverCap: settings.serverRoomCap,
    lastCreatedAt: latest?.createdAt ?? null,
    now: input.now,
    cooldownMinutes: settings.roomCooldownMinutes,
  });
  if (decision !== "allowed") {
    return { result: decision };
  }
  const id = randomUUID();
  const privacy = input.privacy ?? "private";
  const room = await db.tempRoom.create({
    data: {
      id,
      guildId: input.guildId,
      kind: input.kind,
      ownerUserId: input.userId,
      name,
      privacy,
      occupants: json([]),
      invitedUserIds: json([]),
      lastHumanAt: input.now,
      emptySince: input.kind === "voice" ? input.now : null,
      channelState: "pending",
      status: "open",
      disconnectState: "not_applicable",
      createdAt: input.now,
    },
  });
  await scheduleRoom(db, room);
  await enqueueOutbox(db, {
    guildId: input.guildId,
    eventType: "discord.room.open",
    payload: { roomId: id, guildId: input.guildId, kind: input.kind, name, privacy, action: "open" },
    idempotencyKey: `room-open:${id}`,
  });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.userId,
    action: "room.create",
    targetType: "temp_room",
    targetId: id,
    reason: "Create a temporary room",
  });
  return { result: "created" as const, roomId: id, privacy, channelState: "pending" as const, reward: "none" as const };
}

async function canModerate(db: Writer, guildId: string, roleIds: readonly string[]) {
  return (await actorCan(db, { guildId, roleIds, capability: "moderation" })) === "allowed";
}

export async function noteRoomPresence(
  db: Writer,
  input: { guildId: string; roomId: string; userId: string; roleIds: readonly string[]; action: "join" | "leave"; now: Date },
) {
  const room = await roomRecord(db, input.roomId);
  if (!room || room.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  if (room.status !== "open") {
    return { result: "closed" as const };
  }
  const moderation = await canModerate(db, input.guildId, input.roleIds);
  const occupants = stringList(room.occupants);
  const invited = stringList(room.invitedUserIds);
  if (input.action === "join") {
    const access = roomAccess({
      privacy: room.privacy === "public" ? "public" : "private",
      locked: room.locked,
      ownerUserId: room.ownerUserId,
      invited,
      userId: input.userId,
      moderation,
    });
    if (access === "denied") {
      return { result: "denied" as const };
    }
    if (room.capacity > 0 && occupants.length >= room.capacity && !occupants.includes(input.userId)) {
      return { result: "capacity" as const };
    }
  }
  const presence = applyVoicePresence({ occupants, emptySince: room.emptySince, userId: input.userId, action: input.action, now: input.now });
  const nextOwner = input.action === "leave"
    ? transferOwner({ ownerUserId: room.ownerUserId, leavingUserId: input.userId, occupants: presence.occupants })
    : { ownerUserId: room.ownerUserId, needsStaff: room.needsStaff };
  const updated = await db.tempRoom.update({
    where: { id: room.id },
    data: {
      occupants: json(presence.occupants),
      emptySince: room.kind === "voice" ? presence.emptySince : room.emptySince,
      ownerUserId: nextOwner.ownerUserId,
      needsStaff: nextOwner.needsStaff,
    },
  });
  if (room.kind === "voice") {
    await scheduleRoom(db, updated);
  }
  return { result: input.action === "join" ? "joined" as const : "left" as const, ownerUserId: updated.ownerUserId, occupants: presence.occupants, emptySince: updated.emptySince, needsStaff: updated.needsStaff };
}

export async function noteRoomMessage(
  db: Writer,
  input: { guildId: string; roomId: string; authorKind: "human" | "bot" | "system"; now: Date },
) {
  const room = await roomRecord(db, input.roomId);
  if (!room || room.guildId !== input.guildId || room.kind !== "text") {
    return { result: "missing" as const };
  }
  if (room.status !== "open") {
    return { result: "closed" as const };
  }
  const lastHumanAt = applyRoomMessage(room.lastHumanAt, input.authorKind, input.now);
  if (lastHumanAt.getTime() === room.lastHumanAt.getTime()) {
    return { result: "ignored" as const, lastHumanAt: room.lastHumanAt };
  }
  const updated = await db.tempRoom.update({ where: { id: room.id }, data: { lastHumanAt } });
  await scheduleRoom(db, updated);
  return { result: "recorded" as const, lastHumanAt };
}

export async function closeRoom(
  db: Writer,
  input: { guildId: string; roomId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const room = await roomRecord(db, input.roomId);
  if (!room || room.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  if (room.status !== "open") {
    return { result: "already_closed" as const };
  }
  const moderation = await canModerate(db, input.guildId, input.actorRoleIds);
  if (room.ownerUserId !== input.actorUserId && !moderation) {
    return { result: "denied" as const };
  }
  const occupants = stringList(room.occupants);
  const plan = manualClosePlan(room.kind === "voice" ? "voice" : "text", occupants.length);
  await db.tempRoom.update({
    where: { id: room.id },
    data: {
      status: "closed",
      closeReason: "manual",
      closedAt: input.now,
      disconnectState: plan.warnDisconnect ? "setup_required" : "not_applicable",
    },
  });
  if (plan.warnDisconnect) {
    await enqueueOutbox(db, {
      guildId: input.guildId,
      eventType: "discord.room.warn",
      payload: { roomId: room.id, guildId: input.guildId, action: "warn", occupants },
      idempotencyKey: `room-warn:${room.id}`,
    });
  }
  await enqueueOutbox(db, {
    guildId: input.guildId,
    eventType: "discord.room.close",
    payload: { roomId: room.id, guildId: input.guildId, channelId: room.channelId, action: "close" },
    idempotencyKey: `room-close:${room.id}`,
  });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "room.close",
    targetType: "temp_room",
    targetId: room.id,
    reason: "Close a temporary room",
  });
  return { result: "closed" as const, warnDisconnect: plan.warnDisconnect, disconnectState: plan.warnDisconnect ? "setup_required" as const : "not_applicable" as const, occupants };
}

export async function cleanupRoom(db: Writer, roomId: string, now: Date) {
  const room = await roomRecord(db, roomId);
  if (!room) {
    return { result: "missing" as const };
  }
  const decision = cleanupDecision({
    kind: room.kind === "voice" ? "voice" : "text",
    occupants: stringList(room.occupants).length,
    emptySince: room.emptySince,
    lastHumanAt: room.lastHumanAt,
    now,
    missionHold: room.missionHold,
    status: room.status,
  });
  if (decision !== "due") {
    return { result: decision, status: room.status };
  }
  await db.tempRoom.update({
    where: { id: room.id },
    data: { status: "closed", closeReason: "inactivity", closedAt: now, disconnectState: "not_applicable" },
  });
  await enqueueOutbox(db, {
    guildId: room.guildId,
    eventType: "discord.room.close",
    payload: { roomId: room.id, guildId: room.guildId, channelId: room.channelId, action: "close" },
    idempotencyKey: `room-close:${room.id}`,
  });
  return { result: "closed" as const, disconnectState: "not_applicable" as const };
}

export async function sweepRoomCleanup(db: Writer, now: Date) {
  const rooms = await db.tempRoom.findMany({ where: { status: "open" } });
  let queued = 0;
  for (const room of rooms) {
    const decision = cleanupDecision({
      kind: room.kind === "voice" ? "voice" : "text",
      occupants: stringList(room.occupants).length,
      emptySince: room.emptySince,
      lastHumanAt: room.lastHumanAt,
      now,
      missionHold: room.missionHold,
      status: room.status,
    });
    if (decision !== "due") {
      continue;
    }
    const stamp = room.kind === "voice" ? room.emptySince?.toISOString() ?? "empty" : room.lastHumanAt.toISOString();
    const queuedJob = await enqueueJob(db, {
      guildId: room.guildId,
      jobType: room.kind === "voice" ? "room.voice.cleanup" : "room.text.cleanup",
      payload: { roomId: room.id },
      idempotencyKey: `room-${room.kind}:${room.id}:${stamp}`,
      runAt: now,
    });
    if (queuedJob.created) {
      queued += 1;
    }
  }
  return { queued };
}

export async function controlRoom(
  db: Writer,
  input: {
    guildId: string;
    roomId: string;
    actorUserId: string;
    actorRoleIds: readonly string[];
    name?: string;
    locked?: boolean;
    capacity?: number;
    inviteUserId?: string;
    transferUserId?: string;
  },
) {
  const room = await roomRecord(db, input.roomId);
  if (!room || room.guildId !== input.guildId || room.status !== "open") {
    return { result: "missing" as const };
  }
  const moderation = await canModerate(db, input.guildId, input.actorRoleIds);
  if (room.ownerUserId !== input.actorUserId && !moderation) {
    return { result: "denied" as const };
  }
  const invited = stringList(room.invitedUserIds);
  if (input.inviteUserId && !invited.includes(input.inviteUserId)) {
    invited.push(input.inviteUserId);
  }
  let ownerUserId = room.ownerUserId;
  if (input.transferUserId) {
    const present = stringList(room.occupants);
    if (!present.includes(input.transferUserId) && !invited.includes(input.transferUserId)) {
      return { result: "ineligible" as const };
    }
    ownerUserId = input.transferUserId;
  }
  const name = input.name?.trim();
  await db.tempRoom.update({
    where: { id: room.id },
    data: {
      ...(name ? { name } : {}),
      ...(input.locked === undefined ? {} : { locked: input.locked }),
      ...(input.capacity === undefined ? {} : { capacity: Math.max(1, Math.trunc(input.capacity)) }),
      invitedUserIds: json(invited),
      ownerUserId,
      needsStaff: false,
    },
  });
  return { result: "updated" as const, ownerUserId };
}

export async function setRoomHold(db: Writer, input: { guildId: string; roomId: string; reason: string; actorRoleIds: readonly string[] }) {
  const decision = holdDecision(input.reason);
  if (decision !== "mission") {
    return { result: "not_exempt" as const };
  }
  if (!(await canModerate(db, input.guildId, input.actorRoleIds))) {
    return { result: "denied" as const };
  }
  const room = await roomRecord(db, input.roomId);
  if (!room || room.guildId !== input.guildId || room.status !== "open") {
    return { result: "missing" as const };
  }
  await db.tempRoom.update({ where: { id: room.id }, data: { missionHold: true } });
  return { result: "deferred" as const };
}

export async function claimRoom(db: Writer, input: { guildId: string; roomId: string; actorUserId: string; actorRoleIds: readonly string[] }) {
  if (!(await canModerate(db, input.guildId, input.actorRoleIds))) {
    return { result: "denied" as const };
  }
  const room = await roomRecord(db, input.roomId);
  if (!room || room.guildId !== input.guildId || room.status !== "open") {
    return { result: "missing" as const };
  }
  if (!room.needsStaff) {
    return { result: "not_needed" as const };
  }
  await db.tempRoom.update({ where: { id: room.id }, data: { ownerUserId: input.actorUserId, needsStaff: false } });
  return { result: "claimed" as const, ownerUserId: input.actorUserId };
}

export async function deliverRoomChannel(
  db: Writer,
  payload: { roomId: string; action: "open" | "close" },
  executor: () => Promise<{ outcome: "setup_required" } | { outcome: "applied"; channelId?: string } | { outcome: "permission" } | { outcome: "missing" }>,
) {
  const room = await roomRecord(db, payload.roomId);
  if (!room) {
    return { result: "missing" as const };
  }
  if (payload.action === "open" && (room.status !== "open" || room.channelId)) {
    return { result: "skipped" as const };
  }
  if (payload.action === "close" && !room.channelId) {
    await db.tempRoom.update({ where: { id: room.id }, data: { channelState: "not_created" } });
    return { result: "not_created" as const };
  }
  const delivered = await executor();
  if (delivered.outcome === "setup_required") {
    throw new Error("Discord room delivery is setup_required.");
  }
  if (delivered.outcome === "applied" && payload.action === "open" && delivered.channelId) {
    await db.tempRoom.update({ where: { id: room.id }, data: { channelId: delivered.channelId, channelState: "provisioned" } });
    return { result: "provisioned" as const, channelId: delivered.channelId };
  }
  if (delivered.outcome === "applied" && payload.action === "close") {
    await db.tempRoom.update({ where: { id: room.id }, data: { channelState: "deleted" } });
    return { result: "deleted" as const };
  }
  if (delivered.outcome === "missing") {
    await db.tempRoom.update({ where: { id: room.id }, data: { channelState: "missing", status: "closed", closeReason: room.closeReason ?? "missing_channel" } });
    return { result: "missing_channel" as const };
  }
  await db.tempRoom.update({ where: { id: room.id }, data: { channelState: "failed" } });
  return { result: "failed" as const };
}
