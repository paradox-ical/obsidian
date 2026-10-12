import { randomUUID } from "node:crypto";

import {
  checkInOpen,
  nextOccurrence,
  occurrenceKey,
  seatFor,
  sessionSeat,
  timezoneIsValid,
  type AnnouncementCadence,
  type AnnouncementSlot,
  type RsvpResponse,
} from "@collective/domain";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

import { noteContractSignal } from "./contracts.js";
import { openCrewMission } from "./missions.js";
import { actorCan, enqueueJob, ensureGuild, moduleIsAvailable, writeAudit, type Writer } from "./platform.js";
import { recordReward } from "./progression.js";
import { createRoom } from "./seasons.js";

type Root = PrismaClient;
type Tx = Prisma.TransactionClient;

const CADENCES = new Set<AnnouncementCadence>(["once", "daily", "weekly", "monthly"]);
const REMINDER_OFFSETS = [60, 15];

export type ScheduledEventSync = (input: {
  action: "create" | "update" | "cancel";
  guildId: string;
  occurrenceId: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  description: string;
}) => Promise<{ result: "synced"; discordEventId: string } | { result: "setup_required"; reason: string } | { result: "failed"; reason: string }>;

export const setupRequiredEventSync: ScheduledEventSync = async () => ({
  result: "setup_required",
  reason: "Discord scheduled events need a bot token.",
});

interface EventFields {
  name: string;
  game: string;
  description: string;
  links: string;
  hostUserId: string;
  capacity: number;
  waitlist: boolean;
  rewardMarks: number;
  rewardBudget: number;
  durationMinutes: number;
}

function fieldsOf(input: EventFields): EventFields | null {
  const name = input.name.trim();
  const hostUserId = input.hostUserId.trim();
  if (name.length < 1 || name.length > 80 || hostUserId.length < 1) {
    return null;
  }
  if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 1000) {
    return null;
  }
  if (!Number.isInteger(input.rewardMarks) || input.rewardMarks < 0 || !Number.isInteger(input.rewardBudget) || input.rewardBudget < input.rewardMarks) {
    return null;
  }
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 15 || input.durationMinutes > 10_080) {
    return null;
  }
  return {
    name,
    game: input.game.trim().slice(0, 80),
    description: input.description.trim().slice(0, 1000),
    links: input.links.trim().slice(0, 500),
    hostUserId,
    capacity: input.capacity,
    waitlist: input.waitlist,
    rewardMarks: input.rewardMarks,
    rewardBudget: input.rewardBudget,
    durationMinutes: input.durationMinutes,
  };
}

async function moduleOpen(db: Writer, guildId: string) {
  return (await moduleIsAvailable(db, guildId, "events")) ? "ok" as const : "maintenance" as const;
}

async function staff(db: Writer, input: { guildId: string; actorRoleIds: readonly string[] }) {
  const open = await moduleOpen(db, input.guildId);
  if (open !== "ok") {
    return open;
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "event_management" })) !== "allowed") {
    return "denied" as const;
  }
  return "ok" as const;
}

function slotOf(series: {
  cadence: string;
  timezone: string;
  hour: number;
  minute: number;
  weekday: number | null;
  dayOfMonth: number | null;
  endsAt: Date | null;
}): AnnouncementSlot | null {
  if (!CADENCES.has(series.cadence as AnnouncementCadence) || !timezoneIsValid(series.timezone)) {
    return null;
  }
  return {
    cadence: series.cadence as AnnouncementCadence,
    timezone: series.timezone,
    hour: series.hour,
    minute: series.minute,
    weekday: series.weekday,
    dayOfMonth: series.dayOfMonth,
    endsAt: series.endsAt,
  };
}

async function rememberSync(
  db: Writer,
  occurrence: { id: string; guildId: string; name: string; startsAt: Date; endsAt: Date; description: string },
  action: "create" | "update" | "cancel",
  sync: ScheduledEventSync,
) {
  let outcome: Awaited<ReturnType<ScheduledEventSync>>;
  try {
    outcome = await sync({ action, guildId: occurrence.guildId, occurrenceId: occurrence.id, name: occurrence.name, startsAt: occurrence.startsAt, endsAt: occurrence.endsAt, description: occurrence.description });
  } catch (error) {
    outcome = { result: "failed", reason: error instanceof Error ? error.message : "Discord event sync failed." };
  }
  const discordEventId = outcome.result === "synced" ? outcome.discordEventId : null;
  await db.eventSync.create({
    data: {
      id: randomUUID(),
      guildId: occurrence.guildId,
      occurrenceId: occurrence.id,
      action,
      status: outcome.result,
      reason: outcome.result === "synced" ? "Discord scheduled event accepted." : outcome.reason,
      discordEventId,
    },
  });
  if (action !== "cancel") {
    await db.eventOccurrence.update({
      where: { id: occurrence.id },
      data: {
        syncStatus: outcome.result,
        syncReason: outcome.result === "synced" ? "" : outcome.reason,
        ...(discordEventId ? { discordEventId } : {}),
      },
    });
  }
  return outcome;
}

async function scheduleReminders(db: Writer, occurrence: { id: string; guildId: string; startsAt: Date }, now: Date) {
  for (const offsetMinutes of REMINDER_OFFSETS) {
    const runAt = new Date(occurrence.startsAt.getTime() - offsetMinutes * 60_000);
    if (runAt.getTime() <= now.getTime()) {
      continue;
    }
    await db.eventReminder.create({
      data: {
        id: randomUUID(),
        guildId: occurrence.guildId,
        occurrenceId: occurrence.id,
        offsetMinutes,
        status: "pending",
        delivery: "setup_required",
      },
    });
    await enqueueJob(db, {
      guildId: occurrence.guildId,
      jobType: "event.remind",
      payload: { occurrenceId: occurrence.id, offsetMinutes },
      idempotencyKey: `event-remind:${occurrence.id}:${offsetMinutes}`,
      runAt,
    });
  }
}

export async function saveEventTemplate(
  db: Root,
  input: EventFields & { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const fields = fieldsOf(input);
  if (!fields) {
    return { result: "invalid" as const };
  }
  await ensureGuild(db, { guildId: input.guildId });
  const template = await db.eventTemplate.create({
    data: { id: randomUUID(), guildId: input.guildId, ...fields, authorUserId: input.actorUserId, updatedAt: input.now },
  });
  return { result: "saved" as const, template };
}

export async function createEventSeries(
  db: Root,
  input: EventFields & {
    guildId: string;
    templateId?: string | null;
    cadence: AnnouncementCadence;
    timezone: string;
    hour: number;
    minute: number;
    weekday: number | null;
    dayOfMonth: number | null;
    endsAt: Date | null;
    scheduledFor: Date | null;
    actorUserId: string;
    actorRoleIds: readonly string[];
    now: Date;
    sync?: ScheduledEventSync;
  },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const fields = fieldsOf(input);
  const slot = slotOf(input);
  if (!fields || !slot || (input.cadence === "weekly" && (input.weekday === null || input.weekday < 1 || input.weekday > 7)) || (input.cadence === "monthly" && (input.dayOfMonth === null || input.dayOfMonth < 1 || input.dayOfMonth > 31))) {
    return { result: "invalid" as const };
  }
  const startsAt = input.cadence === "once" ? input.scheduledFor : nextOccurrence(slot, input.now);
  if (!startsAt || startsAt.getTime() <= input.now.getTime()) {
    return { result: "invalid" as const };
  }
  const following = input.cadence === "once" ? null : nextOccurrence(slot, startsAt);
  await ensureGuild(db, { guildId: input.guildId });
  const series = await db.eventSeries.create({
    data: {
      id: randomUUID(),
      guildId: input.guildId,
      templateId: input.templateId ?? null,
      ...fields,
      cadence: input.cadence,
      timezone: input.timezone,
      hour: input.hour,
      minute: input.minute,
      weekday: input.weekday,
      dayOfMonth: input.dayOfMonth,
      endsAt: input.endsAt,
      status: following ? "active" : "ended",
      nextStartsAt: following ?? startsAt,
      updatedAt: input.now,
    },
  });
  const occurrence = await openOccurrence(db, series, startsAt, input.now, input.sync ?? setupRequiredEventSync);
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "event.create",
    targetType: "event_series",
    targetId: series.id,
    reason: input.cadence,
  });
  return { result: "scheduled" as const, series, occurrence };
}

async function openOccurrence(
  db: Writer,
  series: EventFields & { id: string; guildId: string; timezone: string },
  startsAt: Date,
  now: Date,
  sync: ScheduledEventSync,
  status: "scheduled" | "skipped" = "scheduled",
) {
  const occurrence = await db.eventOccurrence.create({
    data: {
      id: randomUUID(),
      guildId: series.guildId,
      seriesId: series.id,
      occurrenceKey: occurrenceKey(series.id, startsAt, series.timezone),
      name: series.name,
      game: series.game,
      description: series.description,
      links: series.links,
      hostUserId: series.hostUserId,
      timezone: series.timezone,
      startsAt,
      endsAt: new Date(startsAt.getTime() + series.durationMinutes * 60_000),
      capacity: series.capacity,
      waitlist: series.waitlist,
      rewardMarks: series.rewardMarks,
      rewardBudget: series.rewardBudget,
      status,
      syncStatus: status === "scheduled" ? "pending" : "not_applicable",
      updatedAt: now,
    },
  });
  if (status === "scheduled") {
    await scheduleReminders(db, occurrence, now);
    await rememberSync(db, occurrence, "create", sync);
    return (await db.eventOccurrence.findUnique({ where: { id: occurrence.id } })) ?? occurrence;
  }
  return occurrence;
}

export async function sweepEventSeries(db: Root, now: Date, sync: ScheduledEventSync = setupRequiredEventSync) {
  const due = await db.eventSeries.findMany({
    where: { status: "active", nextStartsAt: { lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) } },
    take: 20,
    orderBy: { nextStartsAt: "asc" },
  });
  let opened = 0;
  for (const series of due) {
    const slot = slotOf(series);
    if (!slot) {
      continue;
    }
    let cursor = series.nextStartsAt;
    for (let step = 0; step < 40; step += 1) {
      if (cursor.getTime() > now.getTime() + 7 * 24 * 60 * 60 * 1000) {
        break;
      }
      const stale = cursor.getTime() <= now.getTime() && now.getTime() - cursor.getTime() > 15 * 60 * 1000;
      const key = occurrenceKey(series.id, cursor, series.timezone);
      const existing = await db.eventOccurrence.findUnique({ where: { seriesId_occurrenceKey: { seriesId: series.id, occurrenceKey: key } } });
      if (!existing) {
        await openOccurrence(db, series, cursor, now, sync, stale ? "skipped" : "scheduled");
        if (!stale) {
          opened += 1;
        }
      }
      const following = nextOccurrence(slot, cursor);
      await db.eventSeries.update({
        where: { id: series.id },
        data: { status: following ? "active" : "ended", nextStartsAt: following ?? cursor, updatedAt: now },
      });
      if (!following || following.getTime() > now.getTime()) {
        break;
      }
      cursor = following;
    }
  }
  return { opened };
}

export async function editEvent(
  db: Root,
  input: { guildId: string; occurrenceId: string; scope: "occurrence" | "series"; name: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date; sync?: ScheduledEventSync },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const name = input.name.trim();
  const occurrence = await db.eventOccurrence.findUnique({ where: { id: input.occurrenceId } });
  if (!occurrence || occurrence.guildId !== input.guildId || name.length < 1) {
    return { result: occurrence ? "invalid" as const : "missing" as const };
  }
  const sync = input.sync ?? setupRequiredEventSync;
  if (input.scope === "occurrence") {
    const updated = await db.eventOccurrence.update({ where: { id: occurrence.id }, data: { name, detached: true, updatedAt: input.now } });
    await rememberSync(db, updated, "update", sync);
    return { result: "updated" as const, scope: "occurrence" as const, occurrence: updated };
  }
  await db.eventSeries.update({ where: { id: occurrence.seriesId }, data: { name, updatedAt: input.now } });
  await db.eventOccurrence.updateMany({
    where: { seriesId: occurrence.seriesId, detached: false, status: "scheduled" },
    data: { name },
  });
  const current = await db.eventOccurrence.findUnique({ where: { id: occurrence.id } });
  if (current && !occurrence.detached) {
    await rememberSync(db, current, "update", sync);
  }
  return { result: "updated" as const, scope: "series" as const };
}

export async function cancelEvent(
  db: Root,
  input: { guildId: string; occurrenceId: string; scope: "occurrence" | "series"; actorUserId: string; actorRoleIds: readonly string[]; now: Date; sync?: ScheduledEventSync },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const occurrence = await db.eventOccurrence.findUnique({ where: { id: input.occurrenceId } });
  if (!occurrence || occurrence.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  const sync = input.sync ?? setupRequiredEventSync;
  if (input.scope === "series") {
    await db.eventSeries.update({ where: { id: occurrence.seriesId }, data: { status: "cancelled", updatedAt: input.now } });
    const upcoming = await db.eventOccurrence.findMany({ where: { seriesId: occurrence.seriesId, status: "scheduled" } });
    for (const row of upcoming) {
      await db.eventOccurrence.update({ where: { id: row.id }, data: { status: "cancelled", updatedAt: input.now } });
      await rememberSync(db, row, "cancel", sync);
    }
    return { result: "cancelled" as const, count: upcoming.length };
  }
  const updated = await db.eventOccurrence.update({ where: { id: occurrence.id }, data: { status: "cancelled", updatedAt: input.now } });
  const outcome = await rememberSync(db, updated, "cancel", sync);
  return { result: "cancelled" as const, sync: outcome.result, discordEventId: outcome.result === "synced" ? outcome.discordEventId : null };
}

export async function transferEventHost(
  db: Root,
  input: { guildId: string; occurrenceId: string; hostUserId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date; sync?: ScheduledEventSync },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const occurrence = await db.eventOccurrence.findUnique({ where: { id: input.occurrenceId } });
  if (!occurrence || occurrence.guildId !== input.guildId || input.hostUserId.trim().length === 0) {
    return { result: occurrence ? "invalid" as const : "missing" as const };
  }
  const updated = await db.eventOccurrence.update({
    where: { id: occurrence.id },
    data: { hostUserId: input.hostUserId.trim(), detached: true, updatedAt: input.now },
  });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "event.transfer",
    targetType: "event_occurrence",
    targetId: occurrence.id,
    reason: input.hostUserId.trim(),
  });
  await rememberSync(db, updated, "update", input.sync ?? setupRequiredEventSync);
  return { result: "transferred" as const, hostUserId: updated.hostUserId };
}

export async function rsvpEvent(
  db: Root,
  input: { guildId: string; occurrenceId: string; userId: string; response: RsvpResponse; now: Date },
) {
  if ((await moduleOpen(db, input.guildId)) !== "ok") {
    return { result: "maintenance" as const };
  }
  if (input.response !== "yes" && input.response !== "maybe" && input.response !== "no") {
    return { result: "invalid" as const };
  }
  const located = await db.eventOccurrence.findUnique({ where: { id: input.occurrenceId } });
  if (!located || located.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "event_occurrence" WHERE "id" = ${located.id} FOR UPDATE`;
    const occurrence = await tx.eventOccurrence.findUnique({ where: { id: located.id } });
    if (!occurrence || occurrence.status !== "scheduled") {
      return { result: "closed" as const };
    }
    const existing = await tx.eventRsvp.findUnique({ where: { occurrenceId_userId: { occurrenceId: occurrence.id, userId: input.userId } } });
    const going = await tx.eventRsvp.count({ where: { occurrenceId: occurrence.id, seat: "going", NOT: { userId: input.userId } } });
    const seat = seatFor({ response: input.response, going, capacity: occurrence.capacity, waitlist: occurrence.waitlist });
    if (seat === "full") {
      return { result: "full" as const };
    }
    const saved = existing
      ? await tx.eventRsvp.update({ where: { id: existing.id }, data: { response: input.response, seat, checkedIn: false, updatedAt: input.now } })
      : await tx.eventRsvp.create({
        data: {
          id: randomUUID(),
          guildId: input.guildId,
          occurrenceId: occurrence.id,
          userId: input.userId,
          response: input.response,
          seat,
          updatedAt: input.now,
        },
      });
    if (existing?.seat === "going" && seat !== "going") {
      await promoteWaitlist(tx, occurrence.id, occurrence.capacity);
    }
    return { result: "recorded" as const, seat: saved.seat };
  });
}

async function promoteWaitlist(tx: Tx, occurrenceId: string, capacity: number) {
  const going = await tx.eventRsvp.count({ where: { occurrenceId, seat: "going" } });
  if (going >= capacity) {
    return;
  }
  const next = await tx.eventRsvp.findFirst({ where: { occurrenceId, seat: "waitlisted" }, orderBy: { createdAt: "asc" } });
  if (next) {
    await tx.eventRsvp.update({ where: { id: next.id }, data: { seat: "going", response: "yes" } });
  }
}

export async function checkInEvent(
  db: Root,
  input: { guildId: string; occurrenceId: string; userId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  if ((await moduleOpen(db, input.guildId)) !== "ok") {
    return { result: "maintenance" as const };
  }
  const staffAccess = await staff(db, input);
  if (input.actorUserId !== input.userId && staffAccess !== "ok") {
    return { result: "denied" as const };
  }
  const occurrence = await db.eventOccurrence.findUnique({ where: { id: input.occurrenceId } });
  const rsvp = occurrence ? await db.eventRsvp.findUnique({ where: { occurrenceId_userId: { occurrenceId: occurrence.id, userId: input.userId } } }) : null;
  if (!occurrence || occurrence.guildId !== input.guildId || !rsvp) {
    return { result: "missing" as const };
  }
  if (occurrence.status !== "scheduled" || rsvp.seat !== "going" || !checkInOpen(input.now, occurrence.startsAt, occurrence.endsAt)) {
    return { result: "closed" as const };
  }
  await db.eventRsvp.update({ where: { id: rsvp.id }, data: { checkedIn: true, updatedAt: input.now } });
  return { result: "checked_in" as const };
}

export async function verifyAttendance(
  db: Root,
  input: { guildId: string; occurrenceId: string; userId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const occurrence = await db.eventOccurrence.findUnique({ where: { id: input.occurrenceId } });
  const rsvp = occurrence ? await db.eventRsvp.findUnique({ where: { occurrenceId_userId: { occurrenceId: occurrence.id, userId: input.userId } } }) : null;
  if (!occurrence || occurrence.guildId !== input.guildId || !rsvp) {
    return { result: "missing" as const };
  }
  if (!rsvp.checkedIn) {
    return { result: "check_in_required" as const };
  }
  if (rsvp.attended) {
    return { result: "already_recorded" as const };
  }
  if (occurrence.rewardSpent + occurrence.rewardMarks > occurrence.rewardBudget) {
    return { result: "budget" as const };
  }
  await db.eventRsvp.update({ where: { id: rsvp.id }, data: { attended: true, updatedAt: input.now } });
  await noteContractSignal(db, { guildId: input.guildId, userId: input.userId, kind: "event_attendance", amount: 1, now: input.now });
  if (occurrence.rewardMarks === 0) {
    return { result: "attended" as const, reward: "none" as const };
  }
  const paid = await recordReward(db, {
    guildId: input.guildId,
    userId: input.userId,
    source: "event.attendance",
    sourceId: occurrence.id,
    kind: "marks",
    amount: occurrence.rewardMarks,
    now: input.now,
  });
  if (paid.result === "recorded" || paid.result === "already_recorded") {
    await db.eventOccurrence.update({ where: { id: occurrence.id }, data: { rewardSpent: { increment: occurrence.rewardMarks } } });
  }
  return { result: paid.result === "recorded" ? "attended" as const : paid.result, reward: paid.result };
}

export async function recapEvent(
  db: Root,
  input: { guildId: string; occurrenceId: string; recap: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const recap = input.recap.trim();
  const occurrence = await db.eventOccurrence.findUnique({ where: { id: input.occurrenceId } });
  if (!occurrence || occurrence.guildId !== input.guildId || recap.length < 1 || recap.length > 1000) {
    return { result: occurrence ? "invalid" as const : "missing" as const };
  }
  await db.eventOccurrence.update({ where: { id: occurrence.id }, data: { recap, status: occurrence.status === "scheduled" ? "completed" : occurrence.status, updatedAt: input.now } });
  return { result: "recorded" as const };
}

export async function linkEvent(
  db: Root,
  input: { guildId: string; occurrenceId: string; kind: "room" | "announcement"; targetId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const occurrence = await db.eventOccurrence.findUnique({ where: { id: input.occurrenceId } });
  if (!occurrence || occurrence.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  if (input.kind === "announcement") {
    const series = await db.announcementSeries.findUnique({ where: { id: input.targetId } });
    if (!series || series.guildId !== input.guildId) {
      return { result: "missing" as const };
    }
    const existing = await db.eventLink.findUnique({ where: { occurrenceId_kind_targetId: { occurrenceId: occurrence.id, kind: "announcement", targetId: series.id } } });
    if (existing) {
      return { result: "already_linked" as const, targetId: series.id };
    }
    await db.eventLink.create({ data: { id: randomUUID(), guildId: input.guildId, occurrenceId: occurrence.id, kind: "announcement", targetId: series.id } });
    return { result: "linked" as const, targetId: series.id };
  }
  const existingRoom = await db.eventLink.findFirst({ where: { occurrenceId: occurrence.id, kind: "room" } });
  if (existingRoom) {
    return { result: "already_linked" as const, targetId: existingRoom.targetId };
  }
  const room = await createRoom(db, { guildId: input.guildId, userId: occurrence.hostUserId, kind: "voice", name: occurrence.name.slice(0, 80), privacy: "public", now: input.now });
  if (room.result !== "created") {
    return { result: room.result };
  }
  await db.eventLink.create({ data: { id: randomUUID(), guildId: input.guildId, occurrenceId: occurrence.id, kind: "room", targetId: room.roomId } });
  return { result: "linked" as const, targetId: room.roomId };
}

export async function deliverEventReminder(db: Root, input: { occurrenceId: string; offsetMinutes: number; now: Date }) {
  const reminder = await db.eventReminder.findUnique({ where: { occurrenceId_offsetMinutes: { occurrenceId: input.occurrenceId, offsetMinutes: input.offsetMinutes } } });
  if (!reminder) {
    return { result: "missing" as const };
  }
  if (reminder.status === "delivered") {
    return { result: "already_recorded" as const };
  }
  const occurrence = await db.eventOccurrence.findUnique({ where: { id: input.occurrenceId } });
  const status = occurrence && occurrence.status === "scheduled" ? "delivered" : "skipped";
  await db.eventReminder.update({ where: { id: reminder.id }, data: { status, delivery: "setup_required" } });
  return { result: status, delivery: "setup_required" as const };
}

export async function createCrew(
  db: Root,
  input: { guildId: string; name: string; game: string; platform: string; region: string; rewardMarks: number; actorUserId: string; now: Date },
) {
  if ((await moduleOpen(db, input.guildId)) !== "ok") {
    return { result: "maintenance" as const };
  }
  const name = input.name.trim();
  if (name.length < 1 || name.length > 80 || !Number.isInteger(input.rewardMarks) || input.rewardMarks < 0) {
    return { result: "invalid" as const };
  }
  await ensureGuild(db, { guildId: input.guildId });
  const crew = await db.crew.create({
    data: {
      id: randomUUID(),
      guildId: input.guildId,
      name,
      game: input.game.trim().slice(0, 80),
      platform: input.platform.trim().slice(0, 40),
      region: input.region.trim().slice(0, 40),
      leaderUserId: input.actorUserId,
      rewardMarks: input.rewardMarks,
      status: "active",
      updatedAt: input.now,
    },
  });
  await db.crewMember.create({
    data: { id: randomUUID(), guildId: input.guildId, crewId: crew.id, userId: input.actorUserId, role: "leader", status: "active", updatedAt: input.now },
  });
  await history(db, input.guildId, crew.id, input.actorUserId, "create", name);
  return { result: "created" as const, crew };
}

async function history(db: Writer, guildId: string, crewId: string, actorUserId: string, action: string, detail: string) {
  await db.crewHistory.create({ data: { id: randomUUID(), guildId, crewId, actorUserId, action, detail } });
}

async function leaderOrStaff(db: Writer, input: { guildId: string; crewId: string; actorUserId: string; actorRoleIds: readonly string[] }) {
  if ((await moduleOpen(db, input.guildId)) !== "ok") {
    return "maintenance" as const;
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "event_management" })) === "allowed") {
    return "ok" as const;
  }
  const member = await db.crewMember.findUnique({ where: { crewId_userId: { crewId: input.crewId, userId: input.actorUserId } } });
  return member && member.status === "active" && (member.role === "leader" || member.role === "officer") ? "ok" as const : "denied" as const;
}

export async function appointOfficer(
  db: Root,
  input: { guildId: string; crewId: string; userId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const gated = await leaderOrStaff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const crew = await db.crew.findUnique({ where: { id: input.crewId } });
  if (!crew || crew.guildId !== input.guildId || crew.status !== "active") {
    return { result: "missing" as const };
  }
  const existing = await db.crewMember.findUnique({ where: { crewId_userId: { crewId: crew.id, userId: input.userId } } });
  if (existing) {
    await db.crewMember.update({ where: { id: existing.id }, data: { role: "officer", status: "active", updatedAt: input.now } });
  } else {
    await db.crewMember.create({
      data: { id: randomUUID(), guildId: input.guildId, crewId: crew.id, userId: input.userId, role: "officer", status: "active", updatedAt: input.now },
    });
  }
  await history(db, input.guildId, crew.id, input.actorUserId, "officer", input.userId);
  return { result: "appointed" as const };
}

export async function transferCrewLeader(
  db: Root,
  input: { guildId: string; crewId: string; userId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  if ((await moduleOpen(db, input.guildId)) !== "ok") {
    return { result: "maintenance" as const };
  }
  const crew = await db.crew.findUnique({ where: { id: input.crewId } });
  if (!crew || crew.guildId !== input.guildId || crew.status !== "active") {
    return { result: "missing" as const };
  }
  const staffAccess = await staff(db, input);
  if (crew.leaderUserId !== input.actorUserId && staffAccess !== "ok") {
    return { result: staffAccess === "maintenance" ? "maintenance" as const : "denied" as const };
  }
  await db.crew.update({ where: { id: crew.id }, data: { leaderUserId: input.userId, updatedAt: input.now } });
  await db.crewMember.updateMany({ where: { crewId: crew.id, userId: crew.leaderUserId }, data: { role: "officer" } });
  const next = await db.crewMember.findUnique({ where: { crewId_userId: { crewId: crew.id, userId: input.userId } } });
  if (next) {
    await db.crewMember.update({ where: { id: next.id }, data: { role: "leader", status: "active", updatedAt: input.now } });
  } else {
    await db.crewMember.create({
      data: { id: randomUUID(), guildId: input.guildId, crewId: crew.id, userId: input.userId, role: "leader", status: "active", updatedAt: input.now },
    });
  }
  await history(db, input.guildId, crew.id, input.actorUserId, "transfer", input.userId);
  return { result: "transferred" as const, leaderUserId: input.userId };
}

export async function disbandCrew(
  db: Root,
  input: { guildId: string; crewId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  if ((await moduleOpen(db, input.guildId)) !== "ok") {
    return { result: "maintenance" as const };
  }
  const crew = await db.crew.findUnique({ where: { id: input.crewId } });
  if (!crew || crew.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  const staffAccess = await staff(db, input);
  if (crew.leaderUserId !== input.actorUserId && staffAccess !== "ok") {
    return { result: staffAccess === "maintenance" ? "maintenance" as const : "denied" as const };
  }
  if (crew.status === "disbanded") {
    return { result: "already_recorded" as const };
  }
  await db.crew.update({ where: { id: crew.id }, data: { status: "disbanded", updatedAt: input.now } });
  await db.crewSession.updateMany({ where: { crewId: crew.id, status: "open" }, data: { status: "cancelled" } });
  await history(db, input.guildId, crew.id, input.actorUserId, "disband", crew.name);
  return { result: "disbanded" as const };
}

export async function createCrewSession(
  db: Root,
  input: {
    guildId: string;
    crewId: string | null;
    name: string;
    game: string;
    platform: string;
    region: string;
    startsAt: Date;
    size: number;
    joinMode: "open" | "approval";
    actorUserId: string;
    actorRoleIds: readonly string[];
    now: Date;
  },
) {
  if ((await moduleOpen(db, input.guildId)) !== "ok") {
    return { result: "maintenance" as const };
  }
  if (!Number.isInteger(input.size) || input.size < 1 || input.size > 100 || input.startsAt.getTime() <= input.now.getTime()) {
    return { result: "invalid" as const };
  }
  const crew = input.crewId ? await db.crew.findUnique({ where: { id: input.crewId } }) : null;
  if (input.crewId && (!crew || crew.guildId !== input.guildId || crew.status !== "active")) {
    return { result: "missing" as const };
  }
  if (crew) {
    const gated = await leaderOrStaff(db, { ...input, crewId: crew.id });
    if (gated !== "ok") {
      return { result: gated };
    }
  }
  await ensureGuild(db, { guildId: input.guildId });
  const session = await db.crewSession.create({
    data: {
      id: randomUUID(),
      guildId: input.guildId,
      crewId: crew?.id ?? null,
      name: input.name.trim().slice(0, 80) || crew?.name || "LFG",
      game: (input.game || crew?.game || "").trim().slice(0, 80),
      platform: (input.platform || crew?.platform || "").trim().slice(0, 40),
      region: (input.region || crew?.region || "").trim().slice(0, 40),
      hostUserId: input.actorUserId,
      startsAt: input.startsAt,
      size: input.size,
      joinMode: input.joinMode,
      status: "open",
      rewardKey: crew ? crew.id : `lfg:${input.actorUserId}:${(input.game || "any").trim().toLowerCase()}`,
      rpgStatus: "module_not_built",
      updatedAt: input.now,
    },
  });
  await db.crewSessionMember.create({
    data: { id: randomUUID(), guildId: input.guildId, sessionId: session.id, userId: input.actorUserId, status: "active", updatedAt: input.now },
  });
  return { result: "created" as const, session };
}

export async function joinCrewSession(
  db: Root,
  input: { guildId: string; sessionId: string; userId: string; now: Date },
) {
  if ((await moduleOpen(db, input.guildId)) !== "ok") {
    return { result: "maintenance" as const };
  }
  const located = await db.crewSession.findUnique({ where: { id: input.sessionId } });
  if (!located || located.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "crew_session" WHERE "id" = ${located.id} FOR UPDATE`;
    const session = await tx.crewSession.findUnique({ where: { id: located.id } });
    if (!session || session.status !== "open") {
      return { result: "closed" as const };
    }
    const existing = await tx.crewSessionMember.findUnique({ where: { sessionId_userId: { sessionId: session.id, userId: input.userId } } });
    if (existing && existing.status !== "left") {
      return { result: "already_recorded" as const, status: existing.status };
    }
    const active = await tx.crewSessionMember.count({ where: { sessionId: session.id, status: "active" } });
    const seat = sessionSeat({ active, size: session.size, joinMode: session.joinMode === "approval" ? "approval" : "open" });
    if (seat === "full") {
      return { result: "full" as const };
    }
    if (existing) {
      await tx.crewSessionMember.update({ where: { id: existing.id }, data: { status: seat, updatedAt: input.now } });
    } else {
      await tx.crewSessionMember.create({
        data: { id: randomUUID(), guildId: input.guildId, sessionId: session.id, userId: input.userId, status: seat, updatedAt: input.now },
      });
    }
    return { result: "joined" as const, status: seat };
  });
}

export async function approveCrewJoin(
  db: Root,
  input: { guildId: string; sessionId: string; userId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const session = await db.crewSession.findUnique({ where: { id: input.sessionId } });
  if (!session || session.guildId !== input.guildId || !session.crewId) {
    return { result: session ? "denied" as const : "missing" as const };
  }
  const gated = await leaderOrStaff(db, { guildId: input.guildId, crewId: session.crewId, actorUserId: input.actorUserId, actorRoleIds: input.actorRoleIds });
  if (gated !== "ok") {
    return { result: gated };
  }
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "crew_session" WHERE "id" = ${session.id} FOR UPDATE`;
    const member = await tx.crewSessionMember.findUnique({ where: { sessionId_userId: { sessionId: session.id, userId: input.userId } } });
    if (!member || member.status !== "pending") {
      return { result: "missing" as const };
    }
    const active = await tx.crewSessionMember.count({ where: { sessionId: session.id, status: "active" } });
    const status = active < session.size ? "active" : "waitlisted";
    await tx.crewSessionMember.update({ where: { id: member.id }, data: { status, updatedAt: input.now } });
    return { result: "approved" as const, status };
  });
}

export async function setCrewReady(
  db: Root,
  input: { guildId: string; sessionId: string; userId: string; ready: boolean; team: string; now: Date },
) {
  const member = await db.crewSessionMember.findUnique({ where: { sessionId_userId: { sessionId: input.sessionId, userId: input.userId } } });
  if (!member || member.guildId !== input.guildId || member.status !== "active") {
    return { result: "missing" as const };
  }
  await db.crewSessionMember.update({ where: { id: member.id }, data: { ready: input.ready, team: input.team.trim().slice(0, 40), updatedAt: input.now } });
  return { result: "ready" as const };
}

export async function attendCrewSession(
  db: Root,
  input: { guildId: string; sessionId: string; userId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const session = await db.crewSession.findUnique({ where: { id: input.sessionId } });
  if (!session || session.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  if (session.crewId) {
    const gated = await leaderOrStaff(db, { guildId: input.guildId, crewId: session.crewId, actorUserId: input.actorUserId, actorRoleIds: input.actorRoleIds });
    if (gated !== "ok") {
      return { result: gated };
    }
  } else if (session.hostUserId !== input.actorUserId) {
    return { result: "denied" as const };
  }
  const member = await db.crewSessionMember.findUnique({ where: { sessionId_userId: { sessionId: session.id, userId: input.userId } } });
  if (!member || member.status !== "active") {
    return { result: "missing" as const };
  }
  if (member.attended) {
    return { result: "already_recorded" as const };
  }
  await db.crewSessionMember.update({ where: { id: member.id }, data: { attended: true, updatedAt: input.now } });
  await noteContractSignal(db, { guildId: input.guildId, userId: input.userId, kind: "crew_session", amount: 1, now: input.now });
  const crew = session.crewId ? await db.crew.findUnique({ where: { id: session.crewId } }) : null;
  const amount = crew?.rewardMarks ?? 0;
  if (amount <= 0) {
    return { result: "attended" as const, reward: "none" as const };
  }
  const paid = await recordReward(db, {
    guildId: input.guildId,
    userId: input.userId,
    source: "crew.attendance",
    sourceId: session.rewardKey,
    kind: "marks",
    amount,
    now: input.now,
  });
  return { result: paid.result === "recorded" ? "attended" as const : "already_recorded" as const, reward: paid.result };
}

export async function requestSessionRoom(
  db: Root,
  input: { guildId: string; sessionId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const session = await db.crewSession.findUnique({ where: { id: input.sessionId } });
  if (!session || session.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  if (session.hostUserId !== input.actorUserId && (await staff(db, input)) !== "ok") {
    return { result: "denied" as const };
  }
  if (session.roomId) {
    return { result: "already_linked" as const, roomId: session.roomId };
  }
  const room = await createRoom(db, { guildId: input.guildId, userId: session.hostUserId, kind: "voice", name: session.name.slice(0, 80), privacy: "public", now: input.now });
  if (room.result !== "created") {
    return { result: room.result };
  }
  await db.crewSession.update({ where: { id: session.id }, data: { roomId: room.roomId, updatedAt: input.now } });
  return { result: "linked" as const, roomId: room.roomId };
}

export async function requestCrewMission(db: Root, input: { guildId: string; crewId: string; now?: Date }) {
  const crew = await db.crew.findUnique({ where: { id: input.crewId } });
  if (!crew || crew.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  return openCrewMission(db, { guildId: input.guildId, crewId: crew.id, userId: crew.leaderUserId, regionSlug: "backstreets", difficulty: "routine", mode: "async", now: input.now ?? new Date() });
}

export async function readGatherings(db: Root, input: { guildId: string; actorRoleIds: readonly string[] }) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const [occurrences, syncs, links, reminders, crews, sessions, historyRows] = await Promise.all([
    db.eventOccurrence.findMany({ where: { guildId: input.guildId }, orderBy: { startsAt: "asc" }, take: 50 }),
    db.eventSync.findMany({ where: { guildId: input.guildId }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.eventLink.findMany({ where: { guildId: input.guildId } }),
    db.eventReminder.findMany({ where: { guildId: input.guildId } }),
    db.crew.findMany({ where: { guildId: input.guildId } }),
    db.crewSession.findMany({ where: { guildId: input.guildId }, orderBy: { startsAt: "asc" } }),
    db.crewHistory.findMany({ where: { guildId: input.guildId }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return { result: "ok" as const, occurrences, syncs, links, reminders, crews, sessions, history: historyRows };
}
