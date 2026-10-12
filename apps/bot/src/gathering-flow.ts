import {
  appointOfficer,
  attendCrewSession,
  approveCrewJoin,
  cancelEvent,
  checkInEvent,
  createCrew,
  createCrewSession,
  createEventSeries,
  disbandCrew,
  editEvent,
  joinCrewSession,
  linkEvent,
  readGatherings,
  recapEvent,
  requestCrewMission,
  requestSessionRoom,
  rsvpEvent,
  setCrewReady,
  transferCrewLeader,
  transferEventHost,
  verifyAttendance,
  type PrismaClient,
} from "@collective/db";

export async function runGatheringCommand(
  db: PrismaClient,
  input: {
    name: string;
    subcommand?: string;
    options: Record<string, string | boolean | number>;
    guildId: string;
    userId: string;
    roleIds: string[];
    now: Date;
  },
) {
  const action = text(input.options, "action");
  const actor = { guildId: input.guildId, actorUserId: input.userId, actorRoleIds: input.roleIds, now: input.now };
  if (input.name === "explore" && input.subcommand === "crew") {
    const mission = await requestCrewMission(db, { guildId: input.guildId, crewId: text(input.options, "crew") });
    return { content: mission.result === "missing" ? "That crew was not found. RPG missions are not built." : "Crew RPG missions are not built. There is no second crew system." };
  }
  if (input.name === "events" && input.subcommand === "rsvp") {
    const response = text(input.options, "response");
    if (response !== "yes" && response !== "maybe" && response !== "no") {
      return { content: "Choose yes, maybe, or no." };
    }
    const saved = await rsvpEvent(db, { guildId: input.guildId, occurrenceId: text(input.options, "occurrence"), userId: input.userId, response, now: input.now });
    return { content: saved.result === "recorded" && "seat" in saved ? `RSVP recorded: ${saved.seat}.` : gatheringText(saved.result) };
  }
  if (input.name === "events" && input.subcommand === "manage") {
    return { content: await manageEvent(db, action, input, actor) };
  }
  if (input.name === "schedule" && input.subcommand === "view") {
    const board = await readGatherings(db, { guildId: input.guildId, actorRoleIds: input.roleIds });
    if (board.result !== "ok") {
      return { content: gatheringText(board.result) };
    }
    const lines = board.occurrences.slice(0, 8).map((row) => `${row.startsAt.toISOString()} ${row.name} ${row.status} sync ${row.syncStatus}`);
    return { content: lines.length > 0 ? lines.join("\n") : "No official occurrences are scheduled." };
  }
  if (input.name === "schedule" && input.subcommand === "control") {
    const kind = action === "link-announcement" ? "announcement" : action === "link-room" ? "room" : "";
    if (!kind) {
      return { content: "Choose link-room or link-announcement." };
    }
    const linked = await linkEvent(db, { ...actor, occurrenceId: text(input.options, "occurrence"), kind, targetId: text(input.options, "target") });
    if (linked.result === "linked") {
      return { content: kind === "room" ? "A temporary room is linked. Discord channel delivery stays setup-required." : "The announcement is linked. No second delivery job was added." };
    }
    return { content: gatheringText(linked.result) };
  }
  if (input.name === "crew" && input.subcommand === "persistent") {
    return { content: await manageCrew(db, action, input, actor) };
  }
  if (input.name === "crew" && (input.subcommand === "session" || input.subcommand === "lfg")) {
    return { content: await manageSession(db, action, input, actor) };
  }
  return { content: "That gathering action is not available." };
}

async function manageEvent(
  db: PrismaClient,
  action: string,
  input: { options: Record<string, string | boolean | number>; guildId: string; userId: string; roleIds: string[]; now: Date },
  actor: { guildId: string; actorUserId: string; actorRoleIds: string[]; now: Date },
) {
  if (action === "create") {
    const when = text(input.options, "when");
    const created = await createEventSeries(db, {
      ...actor,
      name: text(input.options, "name"),
      game: "",
      description: "",
      links: "",
      hostUserId: text(input.options, "host") || input.userId,
      capacity: 25,
      waitlist: true,
      rewardMarks: 0,
      rewardBudget: 0,
      durationMinutes: 60,
      cadence: when ? "once" : "daily",
      timezone: "Australia/Perth",
      hour: 9,
      minute: 0,
      weekday: null,
      dayOfMonth: null,
      endsAt: null,
      scheduledFor: when ? new Date(when) : null,
    });
    if (created.result !== "scheduled") {
      return gatheringText(created.result);
    }
    return `Occurrence ${created.occurrence.id} is scheduled. Discord event sync is ${created.occurrence.syncStatus}.`;
  }
  const occurrenceId = text(input.options, "occurrence");
  if (action === "edit") {
    const scope = text(input.options, "scope") === "series" ? "series" : "occurrence";
    const edited = await editEvent(db, { ...actor, occurrenceId, scope, name: text(input.options, "name") });
    return edited.result === "updated" ? `Updated the ${scope}. Discord sync stays visible on the occurrence.` : gatheringText(edited.result);
  }
  if (action === "cancel") {
    const scope = text(input.options, "scope") === "series" ? "series" : "occurrence";
    const cancelled = await cancelEvent(db, { ...actor, occurrenceId, scope });
    return cancelled.result === "cancelled" ? "The event is cancelled. Discord sync did not invent an event id." : gatheringText(cancelled.result);
  }
  if (action === "transfer") {
    const moved = await transferEventHost(db, { ...actor, occurrenceId, hostUserId: text(input.options, "host") });
    return moved.result === "transferred" ? `Host is now ${moved.hostUserId}.` : gatheringText(moved.result);
  }
  if (action === "checkin") {
    const checked = await checkInEvent(db, { ...actor, occurrenceId, userId: text(input.options, "member") || input.userId });
    return gatheringText(checked.result);
  }
  if (action === "attendance") {
    const attended = await verifyAttendance(db, { ...actor, occurrenceId, userId: text(input.options, "member") });
    return gatheringText(attended.result);
  }
  if (action === "recap") {
    const saved = await recapEvent(db, { ...actor, occurrenceId, recap: text(input.options, "recap") });
    return gatheringText(saved.result);
  }
  return "Choose create, edit, cancel, transfer, checkin, attendance, or recap.";
}

async function manageCrew(
  db: PrismaClient,
  action: string,
  input: { options: Record<string, string | boolean | number>; guildId: string; userId: string; now: Date },
  actor: { guildId: string; actorUserId: string; actorRoleIds: string[]; now: Date },
) {
  if (action === "create") {
    const created = await createCrew(db, { guildId: input.guildId, name: text(input.options, "name"), game: "", platform: "", region: "", rewardMarks: 0, actorUserId: input.userId, now: input.now });
    return created.result === "created" ? `Crew ${created.crew.id} is open. You are the leader.` : gatheringText(created.result);
  }
  const crewId = text(input.options, "crew");
  if (action === "officer") {
    return gatheringText((await appointOfficer(db, { ...actor, crewId, userId: text(input.options, "member") })).result);
  }
  if (action === "transfer") {
    const moved = await transferCrewLeader(db, { ...actor, crewId, userId: text(input.options, "member") });
    return moved.result === "transferred" ? `Leader is now ${moved.leaderUserId}.` : gatheringText(moved.result);
  }
  if (action === "disband") {
    return gatheringText((await disbandCrew(db, { ...actor, crewId })).result);
  }
  if (action === "mission") {
    const mission = await requestCrewMission(db, { guildId: input.guildId, crewId });
    if (mission.result === "short") {
      return "A crew mission needs two to five members. Each member must meet the region level.";
    }
    if (mission.result === "ready") {
      return `Crew mission ${mission.missionId} is ${mission.status}. ${mission.rules} The notice is not posted.`;
    }
    return gatheringText(mission.result);
  }
  return "Choose create, officer, transfer, disband, or mission.";
}

async function manageSession(
  db: PrismaClient,
  action: string,
  input: { options: Record<string, string | boolean | number>; guildId: string; userId: string; roleIds: string[]; subcommand?: string; now: Date },
  actor: { guildId: string; actorUserId: string; actorRoleIds: string[]; now: Date },
) {
  if (action === "list" || (input.subcommand === "lfg" && action !== "join")) {
    const board = await readGatherings(db, { guildId: input.guildId, actorRoleIds: input.roleIds });
    if (board.result !== "ok") {
      return gatheringText(board.result);
    }
    const open = board.sessions.filter((session) => session.status === "open");
    return open.length > 0 ? open.slice(0, 8).map((session) => `${session.id} ${session.game} ${session.platform} ${session.region} ${session.joinMode}`).join("\n") : "No sessions are open.";
  }
  if (action === "create") {
    const when = text(input.options, "when");
    const created = await createCrewSession(db, {
      ...actor,
      crewId: text(input.options, "crew") || null,
      name: text(input.options, "name"),
      game: text(input.options, "game"),
      platform: text(input.options, "platform"),
      region: text(input.options, "region"),
      startsAt: when ? new Date(when) : new Date(input.now.getTime() + 60 * 60 * 1000),
      size: number(input.options, "size", 4),
      joinMode: text(input.options, "mode") === "approval" ? "approval" : "open",
    });
    return created.result === "created" ? `Session ${created.session.id} is open. RPG status is module_not_built.` : gatheringText(created.result);
  }
  const sessionId = text(input.options, "session");
  if (action === "join") {
    const joined = await joinCrewSession(db, { guildId: input.guildId, sessionId, userId: input.userId, now: input.now });
    return joined.result === "joined" && "status" in joined ? `Join recorded: ${joined.status}.` : gatheringText(joined.result);
  }
  if (action === "approve") {
    const approved = await approveCrewJoin(db, { ...actor, sessionId, userId: text(input.options, "member") });
    return approved.result === "approved" && "status" in approved ? `Approval recorded: ${approved.status}.` : gatheringText(approved.result);
  }
  if (action === "ready") {
    return gatheringText((await setCrewReady(db, { guildId: input.guildId, sessionId, userId: input.userId, ready: true, team: "", now: input.now })).result);
  }
  if (action === "attend") {
    return gatheringText((await attendCrewSession(db, { ...actor, sessionId, userId: text(input.options, "member") || input.userId })).result);
  }
  if (action === "room") {
    const room = await requestSessionRoom(db, { ...actor, sessionId });
    return room.result === "linked" ? "A temporary room is linked. Discord channel delivery stays setup-required." : gatheringText(room.result);
  }
  return "Choose create, join, approve, ready, attend, room, or list.";
}

function gatheringText(result: string): string {
  if (result === "denied") return "That action needs the event management capability or crew leadership.";
  if (result === "maintenance") return "Events are in maintenance.";
  if (result === "invalid") return "That gathering input was not accepted.";
  if (result === "missing") return "That event, crew, or member was not found.";
  if (result === "full") return "That event or session is full.";
  if (result === "closed") return "That occurrence or session is not open.";
  if (result === "budget") return "The attendance reward would pass the event budget. Nothing was paid.";
  if (result === "already_recorded" || result === "already_linked") return "That was already recorded. It was not repeated.";
  if (result === "checked_in") return "Check-in recorded.";
  if (result === "attended") return "Attendance recorded. A repeated session does not pay again.";
  if (result === "recorded") return "Recorded.";
  if (result === "appointed") return "Officer appointed.";
  if (result === "disbanded") return "The crew is disbanded.";
  if (result === "ready") return "Readiness recorded.";
  if (result === "module_not_built") return "Crew RPG missions are not built. There is no second crew system.";
  if (result === "setup_required") return "Discord delivery is setup-required.";
  return "That gathering action did not complete.";
}

function text(options: Record<string, string | boolean | number>, key: string): string {
  const value = options[key];
  return typeof value === "string" ? value : "";
}

function number(options: Record<string, string | boolean | number>, key: string, fallback: number): number {
  const value = options[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
