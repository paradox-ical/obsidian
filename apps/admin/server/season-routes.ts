import type { IncomingMessage, ServerResponse } from "node:http";

import {
  cancelPoll,
  createPoll,
  listPolls,
  readLeaderboard,
  readPollResults,
  readSeasonSettings,
  rollSeason,
  saveSeasonSettings,
} from "@collective/db";
import { ROOM_HAS_MAX_LIFETIME, TEXT_IDLE_MS, VOICE_EMPTY_MS, previewSeasonSettings, type SeasonSettingsInput } from "@collective/domain";

import { loadDashboard, type AdminDeps } from "./handler.js";

export async function handleSeasonRoute(
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
  const guildId = current.session.guildId;

  if (request.method === "GET" && url.pathname === "/api/seasons/settings") {
    send(response, 200, { access: "allowed", ...(await readSeasonSettings(deps.db, guildId)) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/seasons/settings") {
    const body = await readJson(request);
    const settings = body["settings"] as SeasonSettingsInput | undefined;
    const reason = typeof body["reason"] === "string" ? body["reason"] : "";
    if (!settings || !reason.trim()) {
      send(response, 400, { error: "invalid_settings", access: "allowed" });
      return;
    }
    if (body["preview"] === true) {
      send(response, 200, { access: "allowed", ...previewSeasonSettings(settings) });
      return;
    }
    const saved = await saveSeasonSettings(deps.db, { guildId, settings, actorUserId: current.session.userId, reason });
    send(response, 200, { ...saved, access: "allowed" });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/seasons/rollover") {
    const body = await readJson(request);
    const reason = typeof body["reason"] === "string" ? body["reason"] : "";
    if (!reason.trim()) {
      send(response, 400, { error: "invalid_reason", access: "allowed" });
      return;
    }
    const rolled = await rollSeason(deps.db, { guildId, now, actorUserId: current.session.userId, reason });
    send(response, 200, { ...rolled, access: "allowed" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/leaderboards") {
    const category = url.searchParams.get("category") ?? "community_xp";
    const page = Number(url.searchParams.get("page") ?? "1");
    const board = await readLeaderboard(deps.db, { guildId, category, page, viewerId: current.session.userId, now });
    send(response, board.result === "invalid" ? 400 : 200, { ...board, access: "allowed" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/polls") {
    const pollId = url.searchParams.get("pollId");
    if (pollId) {
      const results = await readPollResults(deps.db, { guildId, pollId, audience: "staff" });
      send(response, results.result === "missing" ? 404 : 200, { ...results, access: "allowed" });
      return;
    }
    send(response, 200, { access: "allowed", ...(await listPolls(deps.db, guildId)) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/polls") {
    const body = await readJson(request);
    const reason = typeof body["reason"] === "string" ? body["reason"] : "";
    const question = typeof body["question"] === "string" ? body["question"] : "";
    const choices = Array.isArray(body["choices"]) ? body["choices"].filter((choice): choice is string => typeof choice === "string") : [];
    const mode = body["mode"] === "multiple" ? "multiple" : "single";
    const kind = typeof body["kind"] === "string" ? body["kind"] : "poll";
    if (!reason.trim()) {
      send(response, 400, { error: "invalid_reason", access: "allowed" });
      return;
    }
    const created = await createPoll(deps.db, {
      guildId,
      actorUserId: current.session.userId,
      actorRoleIds: current.roleIds,
      question,
      choices,
      mode,
      kind,
      anonymous: body["anonymous"] === true,
      eligibleRoleIds: Array.isArray(body["eligibleRoleIds"]) ? body["eligibleRoleIds"].filter((role): role is string => typeof role === "string") : [],
      opensAt: now,
      closesAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      now,
      reason,
    });
    send(response, created.result === "denied" ? 403 : 200, { ...created, access: created.result === "denied" ? "denied" : "allowed" });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/polls/cancel") {
    const body = await readJson(request);
    const pollId = typeof body["pollId"] === "string" ? body["pollId"] : "";
    const reason = typeof body["reason"] === "string" ? body["reason"] : "";
    if (!pollId || !reason.trim()) {
      send(response, 400, { error: "invalid_poll", access: "allowed" });
      return;
    }
    const cancelled = await cancelPoll(deps.db, { guildId, pollId, actorUserId: current.session.userId, actorRoleIds: current.roleIds, reason, now });
    send(response, cancelled.result === "denied" ? 403 : 200, { ...cancelled, access: cancelled.result === "denied" ? "denied" : "allowed" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/rooms") {
    const settings = await readSeasonSettings(deps.db, guildId);
    send(response, 200, {
      access: "allowed",
      voiceEmptyMs: VOICE_EMPTY_MS,
      textIdleMs: TEXT_IDLE_MS,
      maxLifetime: ROOM_HAS_MAX_LIFETIME,
      suggestions: "excluded",
      settings: settings.settings,
    });
    return;
  }

  send(response, 404, { error: "not_found", access: "allowed" });
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
