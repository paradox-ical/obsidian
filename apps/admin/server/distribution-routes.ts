import type { IncomingMessage, ServerResponse } from "node:http";

import {
  actorCan,
  cancelAnnouncement,
  createAnnouncementSeries,
  noteStickyMessage,
  pauseAnnouncement,
  pinPublication,
  pollFeedSource,
  readDistribution,
  rescheduleAnnouncement,
  resumeAnnouncement,
  saveFeedSource,
  saveReplyRule,
  saveSticky,
  testReplyRule,
  unavailableFeed,
  unpinPublication,
} from "@collective/db";

import { loadDashboard, type AdminDeps } from "./handler.js";

export async function handleDistributionRoute(
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

  if (request.method === "GET" && url.pathname === "/api/distribution") {
    const board = await readDistribution(deps.db, { guildId: actor.guildId, actorRoleIds: actor.actorRoleIds });
    send(response, board.result === "denied" || board.result === "maintenance" ? 403 : 200, board);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/distribution/announcement") {
    const body = await readJson(request);
    const cadence = body["cadence"];
    if (cadence !== "once" && cadence !== "daily" && cadence !== "weekly" && cadence !== "monthly") {
      send(response, 400, { result: "invalid" });
      return;
    }
    const saved = await createAnnouncementSeries(deps.db, {
      ...actor,
      draftId: text(body, "draftId"),
      destination: text(body, "destination"),
      cadence,
      timezone: text(body, "timezone") || "Australia/Perth",
      hour: number(body, "hour", 9),
      minute: number(body, "minute", 0),
      weekday: optionalNumber(body, "weekday"),
      dayOfMonth: optionalNumber(body, "dayOfMonth"),
      endsAt: date(body, "endsAt"),
      removeAfterMinutes: optionalNumber(body, "removeAfterMinutes"),
      scheduledFor: date(body, "scheduledFor"),
    });
    send(response, saved.result === "denied" || saved.result === "maintenance" ? 403 : 200, saved);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/distribution/announcement/pause") {
    const body = await readJson(request);
    const paused = await pauseAnnouncement(deps.db, { ...actor, seriesId: text(body, "seriesId") });
    send(response, paused.result === "denied" || paused.result === "maintenance" ? 403 : 200, paused);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/distribution/announcement/resume") {
    const body = await readJson(request);
    const resumed = await resumeAnnouncement(deps.db, { ...actor, seriesId: text(body, "seriesId") });
    send(response, resumed.result === "denied" || resumed.result === "maintenance" ? 403 : 200, resumed);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/distribution/announcement/reschedule") {
    const body = await readJson(request);
    const moved = await rescheduleAnnouncement(deps.db, {
      ...actor,
      seriesId: text(body, "seriesId"),
      timezone: text(body, "timezone") || "Australia/Perth",
      hour: number(body, "hour", 9),
      minute: number(body, "minute", 0),
      weekday: optionalNumber(body, "weekday"),
      dayOfMonth: optionalNumber(body, "dayOfMonth"),
      endsAt: date(body, "endsAt"),
      scheduledFor: date(body, "scheduledFor"),
    });
    send(response, moved.result === "denied" || moved.result === "maintenance" ? 403 : 200, moved);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/distribution/announcement/cancel") {
    const body = await readJson(request);
    const cancelled = await cancelAnnouncement(deps.db, { ...actor, seriesId: text(body, "seriesId") });
    send(response, cancelled.result === "denied" || cancelled.result === "maintenance" ? 403 : 200, cancelled);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/distribution/pin") {
    const body = await readJson(request);
    const pinned = await pinPublication(deps.db, { ...actor, messageId: text(body, "messageId"), expiresAt: date(body, "expiresAt") });
    send(response, pinned.result === "denied" || pinned.result === "maintenance" ? 403 : 200, pinned);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/distribution/unpin") {
    const body = await readJson(request);
    const unpinned = await unpinPublication(deps.db, { ...actor, pinId: text(body, "pinId") });
    send(response, unpinned.result === "denied" || unpinned.result === "maintenance" ? 403 : 200, unpinned);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/distribution/sticky") {
    const body = await readJson(request);
    const status = body["status"] === "paused" ? "paused" : "active";
    const saved = await saveSticky(deps.db, {
      ...actor,
      channelId: text(body, "channelId"),
      content: text(body, "content"),
      threshold: number(body, "threshold", 5),
      cooldownMs: number(body, "cooldownMs", 60_000),
      expiresAt: date(body, "expiresAt"),
      status,
    });
    send(response, saved.result === "denied" || saved.result === "maintenance" ? 403 : 200, saved);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/distribution/sticky/note") {
    if ((await actorCan(deps.db, { guildId: actor.guildId, roleIds: actor.actorRoleIds, capability: "publications" })) !== "allowed") {
      send(response, 403, { error: "denied", access: "denied" });
      return;
    }
    const body = await readJson(request);
    const noted = await noteStickyMessage(deps.db, {
      guildId: actor.guildId,
      channelId: text(body, "channelId"),
      messageId: text(body, "messageId") || null,
      authorIsBot: body["authorIsBot"] === true,
      now,
    });
    send(response, 200, noted);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/distribution/reply") {
    const body = await readJson(request);
    const kind = body["kind"];
    const visibility = body["visibility"];
    if (kind !== "exact" && kind !== "keyword" && kind !== "pattern" && kind !== "trigger") {
      send(response, 400, { result: "invalid" });
      return;
    }
    if (visibility !== "channel" && visibility !== "dm" && visibility !== "ephemeral") {
      send(response, 400, { result: "invalid" });
      return;
    }
    const saved = await saveReplyRule(deps.db, {
      ...actor,
      ruleId: text(body, "ruleId") || null,
      name: text(body, "name"),
      kind,
      pattern: text(body, "pattern"),
      priority: number(body, "priority", 0),
      channelIds: list(body, "channelIds"),
      excludedChannelIds: list(body, "excludedChannelIds"),
      roleIds: list(body, "roleIds"),
      excludedRoleIds: list(body, "excludedRoleIds"),
      variants: list(body, "variants"),
      visibility,
      secret: body["secret"] === true,
      cooldownMs: number(body, "cooldownMs", 0),
      status: body["status"] === "paused" ? "paused" : "active",
    });
    send(response, saved.result === "denied" || saved.result === "maintenance" ? 403 : 200, saved);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/distribution/reply/test") {
    const body = await readJson(request);
    const source = body["source"] === "interaction" ? "interaction" : "message";
    const tested = await testReplyRule(deps.db, {
      guildId: actor.guildId,
      text: text(body, "text"),
      source,
      channelId: text(body, "channelId"),
      roleIds: list(body, "roleIds"),
      authorIsBot: body["authorIsBot"] === true,
      pick: number(body, "pick", 0),
      actorRoleIds: actor.actorRoleIds,
    });
    send(response, tested.result === "denied" || tested.result === "maintenance" ? 403 : 200, tested);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/distribution/feed") {
    const body = await readJson(request);
    const mode = body["mode"] === "approval" ? "approval" : "automatic";
    const saved = await saveFeedSource(deps.db, {
      ...actor,
      sourceId: text(body, "sourceId") || null,
      name: text(body, "name"),
      adapter: text(body, "adapter") || "json",
      url: text(body, "url"),
      mode,
      destination: text(body, "destination"),
      status: body["status"] === "paused" ? "paused" : "active",
    });
    send(response, saved.result === "denied" || saved.result === "maintenance" ? 403 : 200, saved);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/distribution/feed/poll") {
    const body = await readJson(request);
    const payload = body["payload"];
    if ((await actorCan(deps.db, { guildId: actor.guildId, roleIds: actor.actorRoleIds, capability: "publications" })) !== "allowed") {
      send(response, 403, { error: "denied", access: "denied" });
      return;
    }
    const polled = await pollFeedSource(deps.db, {
      sourceId: text(body, "sourceId"),
      guildId: actor.guildId,
      now,
      fetcher: payload === undefined ? unavailableFeed : async () => ({ available: true, payload }),
    });
    send(response, 200, polled);
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
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function date(body: Record<string, unknown>, key: string): Date | null {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function list(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value === "string") {
    return value.split(/[\s,]+/).filter((entry) => entry.length > 0);
  }
  return [];
}
