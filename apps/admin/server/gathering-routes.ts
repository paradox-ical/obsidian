import type { IncomingMessage, ServerResponse } from "node:http";

import {
  approveCrewJoin,
  attendCrewSession,
  cancelEvent,
  checkInEvent,
  createCrew,
  createCrewSession,
  createEventSeries,
  editEvent,
  joinCrewSession,
  linkEvent,
  readGatherings,
  recapEvent,
  requestCrewMission,
  requestSessionRoom,
  rsvpEvent,
  transferCrewLeader,
  transferEventHost,
  verifyAttendance,
} from "@collective/db";

import { loadDashboard, type AdminDeps } from "./handler.js";

export async function handleGatheringRoute(
  request: IncomingMessage,
  response: ServerResponse,
  deps: AdminDeps,
  now: Date,
  url: URL,
): Promise<void> {
  const current = await loadDashboard(request, deps, now);
  if (!current.ok) {
    send(response, 403, { error: "denied", access: "denied" });
    return;
  }
  if (request.method !== "GET" && request.headers["x-csrf-token"] !== current.session.csrfToken) {
    send(response, 403, { error: "denied", access: "denied" });
    return;
  }
  const actor = { guildId: current.session.guildId, actorUserId: current.session.userId, actorRoleIds: current.roleIds, now };
  if (request.method === "GET" && url.pathname === "/api/gatherings") {
    const board = await readGatherings(deps.db, { guildId: actor.guildId, actorRoleIds: actor.actorRoleIds });
    send(response, board.result === "denied" || board.result === "maintenance" ? 403 : 200, board);
    return;
  }
  if (request.method !== "POST") {
    send(response, 404, { error: "not_found", access: "denied" });
    return;
  }
  const body = await readJson(request);
  const cadence = body["cadence"];
  const scope = body["scope"] === "series" ? "series" : "occurrence";
  if (url.pathname === "/api/gatherings/event") {
    if (cadence !== "once" && cadence !== "daily" && cadence !== "weekly" && cadence !== "monthly") {
      send(response, 400, { result: "invalid" });
      return;
    }
    const saved = await createEventSeries(deps.db, {
      ...actor,
      name: text(body, "name"),
      game: text(body, "game"),
      description: text(body, "description"),
      links: text(body, "links"),
      hostUserId: text(body, "hostUserId") || actor.actorUserId,
      capacity: number(body, "capacity", 25),
      waitlist: body["waitlist"] !== false,
      rewardMarks: number(body, "rewardMarks", 0),
      rewardBudget: number(body, "rewardBudget", 0),
      durationMinutes: number(body, "durationMinutes", 60),
      cadence,
      timezone: text(body, "timezone") || "Australia/Perth",
      hour: number(body, "hour", 9),
      minute: number(body, "minute", 0),
      weekday: optionalNumber(body, "weekday"),
      dayOfMonth: optionalNumber(body, "dayOfMonth"),
      endsAt: date(body, "endsAt"),
      scheduledFor: date(body, "scheduledFor"),
    });
    send(response, saved.result === "denied" || saved.result === "maintenance" ? 403 : 200, saved);
    return;
  }
  if (url.pathname === "/api/gatherings/event/edit") {
    const edited = await editEvent(deps.db, { ...actor, occurrenceId: text(body, "occurrenceId"), scope, name: text(body, "name") });
    send(response, edited.result === "denied" || edited.result === "maintenance" ? 403 : 200, edited);
    return;
  }
  if (url.pathname === "/api/gatherings/event/cancel") {
    const cancelled = await cancelEvent(deps.db, { ...actor, occurrenceId: text(body, "occurrenceId"), scope });
    send(response, cancelled.result === "denied" || cancelled.result === "maintenance" ? 403 : 200, cancelled);
    return;
  }
  if (url.pathname === "/api/gatherings/event/transfer") {
    const moved = await transferEventHost(deps.db, { ...actor, occurrenceId: text(body, "occurrenceId"), hostUserId: text(body, "hostUserId") });
    send(response, moved.result === "denied" || moved.result === "maintenance" ? 403 : 200, moved);
    return;
  }
  if (url.pathname === "/api/gatherings/event/rsvp") {
    const responseName = text(body, "response");
    if (responseName !== "yes" && responseName !== "maybe" && responseName !== "no") {
      send(response, 400, { result: "invalid" });
      return;
    }
    const saved = await rsvpEvent(deps.db, { guildId: actor.guildId, occurrenceId: text(body, "occurrenceId"), userId: text(body, "userId") || actor.actorUserId, response: responseName, now });
    send(response, 200, saved);
    return;
  }
  if (url.pathname === "/api/gatherings/event/checkin") {
    const checked = await checkInEvent(deps.db, { ...actor, occurrenceId: text(body, "occurrenceId"), userId: text(body, "userId") || actor.actorUserId });
    send(response, 200, checked);
    return;
  }
  if (url.pathname === "/api/gatherings/event/attendance") {
    const attended = await verifyAttendance(deps.db, { ...actor, occurrenceId: text(body, "occurrenceId"), userId: text(body, "userId") });
    send(response, attended.result === "denied" || attended.result === "maintenance" ? 403 : 200, attended);
    return;
  }
  if (url.pathname === "/api/gatherings/event/recap") {
    const saved = await recapEvent(deps.db, { ...actor, occurrenceId: text(body, "occurrenceId"), recap: text(body, "recap") });
    send(response, saved.result === "denied" || saved.result === "maintenance" ? 403 : 200, saved);
    return;
  }
  if (url.pathname === "/api/gatherings/event/link") {
    const kind = body["kind"] === "announcement" ? "announcement" : "room";
    const linked = await linkEvent(deps.db, { ...actor, occurrenceId: text(body, "occurrenceId"), kind, targetId: text(body, "targetId") });
    send(response, linked.result === "denied" || linked.result === "maintenance" ? 403 : 200, linked);
    return;
  }
  if (url.pathname === "/api/gatherings/crew") {
    const created = await createCrew(deps.db, { guildId: actor.guildId, name: text(body, "name"), game: text(body, "game"), platform: text(body, "platform"), region: text(body, "region"), rewardMarks: number(body, "rewardMarks", 0), actorUserId: actor.actorUserId, now });
    send(response, 200, created);
    return;
  }
  if (url.pathname === "/api/gatherings/crew/transfer") {
    const moved = await transferCrewLeader(deps.db, { ...actor, crewId: text(body, "crewId"), userId: text(body, "userId") });
    send(response, 200, moved);
    return;
  }
  if (url.pathname === "/api/gatherings/session") {
    const startsAt = date(body, "startsAt") ?? new Date(now.getTime() + 60 * 60 * 1000);
    const created = await createCrewSession(deps.db, {
      ...actor,
      crewId: text(body, "crewId") || null,
      name: text(body, "name"),
      game: text(body, "game"),
      platform: text(body, "platform"),
      region: text(body, "region"),
      startsAt,
      size: number(body, "size", 4),
      joinMode: body["joinMode"] === "approval" ? "approval" : "open",
    });
    send(response, 200, created);
    return;
  }
  if (url.pathname === "/api/gatherings/session/join") {
    const joined = await joinCrewSession(deps.db, { guildId: actor.guildId, sessionId: text(body, "sessionId"), userId: text(body, "userId") || actor.actorUserId, now });
    send(response, 200, joined);
    return;
  }
  if (url.pathname === "/api/gatherings/session/approve") {
    const approved = await approveCrewJoin(deps.db, { ...actor, sessionId: text(body, "sessionId"), userId: text(body, "userId") });
    send(response, 200, approved);
    return;
  }
  if (url.pathname === "/api/gatherings/session/attend") {
    const attended = await attendCrewSession(deps.db, { ...actor, sessionId: text(body, "sessionId"), userId: text(body, "userId") });
    send(response, 200, attended);
    return;
  }
  if (url.pathname === "/api/gatherings/session/room") {
    const room = await requestSessionRoom(deps.db, { ...actor, sessionId: text(body, "sessionId") });
    send(response, 200, room);
    return;
  }
  if (url.pathname === "/api/gatherings/mission") {
    const mission = await requestCrewMission(deps.db, { guildId: actor.guildId, crewId: text(body, "crewId") });
    send(response, 200, mission);
    return;
  }
  send(response, 404, { error: "not_found", access: "denied" });
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function text(body: Record<string, unknown>, key: string): string {
  return typeof body[key] === "string" ? body[key] : "";
}

function number(body: Record<string, unknown>, key: string, fallback: number): number {
  return optionalNumber(body, key) ?? fallback;
}

function optionalNumber(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function date(body: Record<string, unknown>, key: string): Date | null {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
