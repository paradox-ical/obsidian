import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";
import {
  attendCrewSession,
  approveCrewJoin,
  cancelEvent,
  checkInEvent,
  createCrew,
  createCrewSession,
  createEventSeries,
  editEvent,
  joinCrewSession,
  linkEvent,
  requestCrewMission,
  requestSessionRoom,
  rsvpEvent,
  sweepEventSeries,
  transferEventHost,
  verifyAttendance,
} from "./gatherings.js";
import { grantCapability } from "./platform.js";
import { cleanupRoom } from "./seasons.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const staffRoles = ["event-role"];
const now = new Date("2026-10-11T00:00:00.000Z");

afterAll(async () => {
  await db.eventReminder.deleteMany({ where: { guildId } });
  await db.eventLink.deleteMany({ where: { guildId } });
  await db.eventSync.deleteMany({ where: { guildId } });
  await db.eventRsvp.deleteMany({ where: { guildId } });
  await db.eventOccurrence.deleteMany({ where: { guildId } });
  await db.eventSeries.deleteMany({ where: { guildId } });
  await db.eventTemplate.deleteMany({ where: { guildId } });
  await db.crewSessionMember.deleteMany({ where: { guildId } });
  await db.crewSession.deleteMany({ where: { guildId } });
  await db.crewHistory.deleteMany({ where: { guildId } });
  await db.crewMember.deleteMany({ where: { guildId } });
  await db.crew.deleteMany({ where: { guildId } });
  await db.tempRoom.deleteMany({ where: { guildId } });
  await db.rewardEvent.deleteMany({ where: { guildId } });
  await db.ledgerEntry.deleteMany({ where: { guildId } });
  await db.wallet.deleteMany({ where: { guildId } });
  await db.issuanceBudget.deleteMany({ where: { guildId } });
  await db.economySettings.deleteMany({ where: { guildId } });
  await db.outboxMessage.deleteMany({ where: { guildId } });
  await db.job.deleteMany({ where: { guildId } });
  await db.auditRecord.deleteMany({ where: { guildId } });
  await db.capabilityGrant.deleteMany({ where: { guildId } });
  await db.guild.deleteMany({ where: { guildId } });
  await db.$disconnect();
});

const base = {
  guildId,
  game: "Raid",
  description: "Bring a lamp.",
  links: "https://example.com/raid",
  hostUserId: "host-1",
  capacity: 2,
  waitlist: true,
  rewardMarks: 10,
  rewardBudget: 10,
  durationMinutes: 60,
  cadence: "daily" as const,
  timezone: "Australia/Perth",
  hour: 9,
  minute: 0,
  weekday: null,
  dayOfMonth: null,
  endsAt: null,
  scheduledFor: null,
  actorUserId: "coordinator",
  actorRoleIds: staffRoles,
  now,
};

describe("official events and crews", () => {
  it("keeps one seat under a race, edits one occurrence, transfers the host, and pays attendance once", async () => {
    expect(await createEventSeries(db, { ...base, name: "Raid" })).toMatchObject({ result: "denied" });
    await grantCapability(db, { guildId, roleId: "event-role", capability: "event_management", actorUserId: "owner", reason: "Open events" });

    const created = await createEventSeries(db, { ...base, name: "Raid" });
    if (created.result !== "scheduled") {
      throw new Error(created.result);
    }
    expect(created.occurrence.discordEventId).toBeNull();
    expect(created.occurrence.syncStatus).toBe("setup_required");
    const edited = await editEvent(db, { guildId, occurrenceId: created.occurrence.id, scope: "occurrence", name: "Special", actorUserId: "coordinator", actorRoleIds: staffRoles, now });
    expect(edited.result).toBe("updated");
    await editEvent(db, { guildId, occurrenceId: created.occurrence.id, scope: "series", name: "Weekly", actorUserId: "coordinator", actorRoleIds: staffRoles, now });
    await sweepEventSeries(db, new Date("2026-10-11T00:30:00.000Z"));
    const rows = await db.eventOccurrence.findMany({ where: { seriesId: created.series.id }, orderBy: { startsAt: "asc" } });
    expect(rows.map((row) => row.name)).toEqual(["Special", "Weekly"]);
    expect(rows[0]?.detached).toBe(true);
    expect(rows[1]?.detached).toBe(false);

    const transferred = await transferEventHost(db, { guildId, occurrenceId: created.occurrence.id, hostUserId: "host-2", actorUserId: "coordinator", actorRoleIds: staffRoles, now });
    expect(transferred).toMatchObject({ result: "transferred", hostUserId: "host-2" });
    expect(await db.auditRecord.count({ where: { guildId, action: "event.transfer" } })).toBe(1);

    const limited = await createEventSeries(db, {
      ...base,
      name: "Door",
      cadence: "once",
      capacity: 1,
      scheduledFor: new Date("2026-10-16T01:00:00.000Z"),
      sync: async () => ({ result: "failed", reason: "Discord rejected the scheduled event." }),
    });
    if (limited.result !== "scheduled") {
      throw new Error(limited.result);
    }
    expect(limited.occurrence.discordEventId).toBeNull();
    expect(limited.occurrence.syncStatus).toBe("failed");
    const [first, second] = await Promise.all([
      rsvpEvent(db, { guildId, occurrenceId: limited.occurrence.id, userId: "member-a", response: "yes", now }),
      rsvpEvent(db, { guildId, occurrenceId: limited.occurrence.id, userId: "member-b", response: "yes", now }),
    ]);
    expect([first, second].map((entry) => entry.result).sort()).toEqual(["recorded", "recorded"]);
    const seats = [first, second].map((entry) => ("seat" in entry ? entry.seat : "")).sort();
    expect(seats).toEqual(["going", "waitlisted"]);

    const checkNow = new Date("2026-10-16T00:50:00.000Z");
    const going = "seat" in first && first.seat === "going" ? "member-a" : "member-b";
    expect(await checkInEvent(db, { guildId, occurrenceId: limited.occurrence.id, userId: going, actorUserId: going, actorRoleIds: [], now: checkNow })).toMatchObject({ result: "checked_in" });
    expect(await verifyAttendance(db, { guildId, occurrenceId: limited.occurrence.id, userId: going, actorUserId: "coordinator", actorRoleIds: staffRoles, now: checkNow })).toMatchObject({ result: "attended" });
    expect(await verifyAttendance(db, { guildId, occurrenceId: limited.occurrence.id, userId: going, actorUserId: "coordinator", actorRoleIds: staffRoles, now: checkNow })).toMatchObject({ result: "already_recorded" });
    expect(await db.rewardEvent.count({ where: { guildId, source: "event.attendance" } })).toBe(1);

    const cancelled = await cancelEvent(db, { guildId, occurrenceId: limited.occurrence.id, scope: "occurrence", actorUserId: "coordinator", actorRoleIds: staffRoles, now: checkNow });
    expect(cancelled).toMatchObject({ result: "cancelled", sync: "setup_required", discordEventId: null });

    const crew = await createCrew(db, { guildId, name: "Night watch", game: "Raid", platform: "pc", region: "oce", rewardMarks: 10, actorUserId: "leader", now });
    if (crew.result !== "created") {
      throw new Error(crew.result);
    }
    const session = await createCrewSession(db, {
      guildId,
      crewId: crew.crew.id,
      name: "Night watch",
      game: "Raid",
      platform: "pc",
      region: "oce",
      startsAt: new Date("2026-10-12T01:00:00.000Z"),
      size: 2,
      joinMode: "open",
      actorUserId: "leader",
      actorRoleIds: [],
      now,
    });
    if (session.result !== "created") {
      throw new Error(session.result);
    }
    const joined = await Promise.all([
      joinCrewSession(db, { guildId, sessionId: session.session.id, userId: "player-a", now }),
      joinCrewSession(db, { guildId, sessionId: session.session.id, userId: "player-b", now }),
    ]);
    expect(joined.map((entry) => ("status" in entry ? entry.status : "")).sort()).toEqual(["active", "waitlisted"]);
    const activeUser = joined[0] && "status" in joined[0] && joined[0].status === "active" ? "player-a" : "player-b";
    expect(await attendCrewSession(db, { guildId, sessionId: session.session.id, userId: activeUser, actorUserId: "leader", actorRoleIds: [], now: checkNow })).toMatchObject({ result: "attended" });

    const again = await createCrewSession(db, {
      guildId,
      crewId: crew.crew.id,
      name: "Night watch 2",
      game: "Raid",
      platform: "pc",
      region: "oce",
      startsAt: new Date("2026-10-13T01:00:00.000Z"),
      size: 2,
      joinMode: "approval",
      actorUserId: "leader",
      actorRoleIds: [],
      now,
    });
    if (again.result !== "created") {
      throw new Error(again.result);
    }
    expect(await joinCrewSession(db, { guildId, sessionId: again.session.id, userId: activeUser, now })).toMatchObject({ result: "joined", status: "pending" });
    expect(await approveCrewJoin(db, { guildId, sessionId: again.session.id, userId: activeUser, actorUserId: "leader", actorRoleIds: [], now })).toMatchObject({ result: "approved", status: "active" });
    expect(await attendCrewSession(db, { guildId, sessionId: again.session.id, userId: activeUser, actorUserId: "leader", actorRoleIds: [], now: checkNow })).toMatchObject({ result: "already_recorded" });
    expect(await db.rewardEvent.count({ where: { guildId, source: "crew.attendance", userId: activeUser } })).toBe(1);

    const room = await requestSessionRoom(db, { guildId, sessionId: session.session.id, actorUserId: "leader", actorRoleIds: [], now });
    if (room.result !== "linked") {
      throw new Error(room.result);
    }
    expect(await requestSessionRoom(db, { guildId, sessionId: session.session.id, actorUserId: "leader", actorRoleIds: [], now })).toMatchObject({ result: "already_linked" });
    await db.tempRoom.update({ where: { id: room.roomId }, data: { emptySince: new Date(checkNow.getTime() - 7 * 60 * 60 * 1000), occupants: [] } });
    expect(await cleanupRoom(db, room.roomId, checkNow)).toMatchObject({ result: "closed" });
    expect(await requestCrewMission(db, { guildId, crewId: crew.crew.id, now })).toMatchObject({ result: "short" });
    expect(await linkEvent(db, { guildId, occurrenceId: created.occurrence.id, kind: "room", targetId: "", actorUserId: "coordinator", actorRoleIds: staffRoles, now })).toMatchObject({ result: "linked" });
  });
});
