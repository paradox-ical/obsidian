import type { IncomingMessage, ServerResponse } from "node:http";

import {
  addGiveawayBonus,
  awardContest,
  cancelGiveaway,
  cancelPrediction,
  closeContest,
  closeGiveaway,
  correctContest,
  createContest,
  createGiveaway,
  createPrediction,
  disqualifyGiveaway,
  drawGiveaway,
  enterGiveaway,
  enterPrediction,
  publishContest,
  readActivities,
  rerollGiveaway,
  resolvePrediction,
  reversePrediction,
  savePrizeStock,
  submitContestEntry,
} from "@collective/db";

import { loadDashboard, type AdminDeps } from "./handler.js";

export async function handleActivityRoute(
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
  if (request.method === "GET" && url.pathname === "/api/activities") {
    const board = await readActivities(deps.db, { guildId: actor.guildId, actorRoleIds: actor.actorRoleIds });
    send(response, board.result === "denied" || board.result === "maintenance" ? 403 : 200, board);
    return;
  }
  if (request.method !== "POST") {
    send(response, 404, { error: "not_found", access: "denied" });
    return;
  }
  const body = await readJson(request);
  if (url.pathname === "/api/activities/prediction") {
    const mode = body["mode"] === "staked" ? "staked" : "free";
    const lockAt = date(body, "lockAt") ?? new Date(now.getTime() + 60 * 60 * 1000);
    const saved = await createPrediction(deps.db, {
      ...actor,
      title: text(body, "title"),
      mode,
      rules: text(body, "rules") || "Official result after the lock.",
      evidence: text(body, "evidence") || "Evidence is recorded at resolution.",
      outcomes: ["Yes", "No"],
      lockAt,
      points: number(body, "points", 1),
      prizeMarks: number(body, "prizeMarks", 0),
    });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/activities/prediction/enter") {
    const saved = await enterPrediction(deps.db, {
      guildId: actor.guildId,
      predictionId: text(body, "predictionId"),
      userId: text(body, "userId") || actor.actorUserId,
      outcomeId: text(body, "outcomeId"),
      stakeMarks: number(body, "stakeMarks", 0),
      roleIds: actor.actorRoleIds,
      accountAgeDays: number(body, "accountAgeDays", 365),
      acknowledged: body["acknowledged"] === true,
      now,
    });
    send(response, 200, saved);
    return;
  }
  if (url.pathname === "/api/activities/prediction/resolve") {
    const saved = await resolvePrediction(deps.db, { ...actor, predictionId: text(body, "predictionId"), outcomeId: text(body, "outcomeId"), evidence: text(body, "evidence") });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/activities/prediction/cancel") {
    const saved = await cancelPrediction(deps.db, { ...actor, predictionId: text(body, "predictionId") });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/activities/prediction/reverse") {
    const saved = await reversePrediction(deps.db, { ...actor, predictionId: text(body, "predictionId"), reason: text(body, "reason") });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/activities/contest") {
    const mode = body["mode"] === "judge" ? "judge" : "vote";
    const saved = await createContest(deps.db, {
      ...actor,
      title: text(body, "title"),
      mode,
      rules: text(body, "rules") || "Published rules apply before entries.",
      category: text(body, "category") || "community",
      allowedTypes: ["text", "image"],
      closesAt: date(body, "closesAt") ?? new Date(now.getTime() + 60 * 60 * 1000),
      tiePolicy: "publish",
      ...(mode === "judge" ? { criteria: [{ name: "craft", weight: 1 }, { name: "lore", weight: 3 }] } : {}),
      stockId: text(body, "stockId"),
      prizeQuantity: number(body, "prizeQuantity", text(body, "stockId") ? 1 : 0),
    });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/activities/contest/publish") {
    const saved = await publishContest(deps.db, { ...actor, contestId: text(body, "contestId") });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/activities/contest/submit") {
    const saved = await submitContestEntry(deps.db, {
      guildId: actor.guildId,
      contestId: text(body, "contestId"),
      userId: text(body, "userId") || actor.actorUserId,
      title: text(body, "title"),
      mediaType: text(body, "mediaType") || "text",
      body: text(body, "body"),
      roleIds: actor.actorRoleIds,
      now,
    });
    send(response, 200, saved);
    return;
  }
  if (url.pathname === "/api/activities/contest/close") {
    const saved = await closeContest(deps.db, { ...actor, contestId: text(body, "contestId") });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/activities/contest/correct") {
    const saved = await correctContest(deps.db, { ...actor, contestId: text(body, "contestId"), entryId: text(body, "entryId"), reason: text(body, "reason") });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/activities/contest/award") {
    const saved = await awardContest(deps.db, { ...actor, contestId: text(body, "contestId"), winnerEntryId: text(body, "entryId"), reason: text(body, "reason") || "Award the published result" });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/activities/giveaway") {
    const saved = await createGiveaway(deps.db, {
      ...actor,
      title: text(body, "title"),
      rules: text(body, "rules") || "One free entry. Bonus entries come from verified activities.",
      bonusRules: text(body, "bonusRules") || "Each verified activity can add one bonus until the cap.",
      closesAt: date(body, "closesAt") ?? new Date(now.getTime() + 60 * 60 * 1000),
      maxBonus: number(body, "maxBonus", 1),
      stockId: text(body, "stockId"),
      sponsor: text(body, "sponsor"),
    });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/activities/giveaway/enter") {
    const saved = await enterGiveaway(deps.db, { guildId: actor.guildId, giveawayId: text(body, "giveawayId"), userId: text(body, "userId") || actor.actorUserId, roleIds: actor.actorRoleIds, accountAgeDays: 365, now });
    send(response, 200, saved);
    return;
  }
  if (url.pathname === "/api/activities/giveaway/bonus") {
    const saved = await addGiveawayBonus(deps.db, {
      guildId: actor.guildId,
      giveawayId: text(body, "giveawayId"),
      userId: text(body, "userId") || actor.actorUserId,
      activityKey: text(body, "activityKey"),
      roleIds: actor.actorRoleIds,
      accountAgeDays: 365,
      now,
    });
    send(response, 200, saved);
    return;
  }
  if (url.pathname === "/api/activities/giveaway/close") {
    const saved = await closeGiveaway(deps.db, { ...actor, giveawayId: text(body, "giveawayId") });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/activities/giveaway/draw") {
    const saved = await drawGiveaway(deps.db, { ...actor, giveawayId: text(body, "giveawayId") });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/activities/giveaway/reroll") {
    const saved = await rerollGiveaway(deps.db, { ...actor, giveawayId: text(body, "giveawayId"), reason: text(body, "reason") });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/activities/giveaway/disqualify") {
    const saved = await disqualifyGiveaway(deps.db, { ...actor, drawId: text(body, "drawId"), reason: text(body, "reason") });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/activities/giveaway/cancel") {
    const saved = await cancelGiveaway(deps.db, { ...actor, giveawayId: text(body, "giveawayId") });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/activities/stock") {
    const kind = body["kind"] === "marks" || body["kind"] === "external_key" ? body["kind"] : "item";
    const saved = await savePrizeStock(deps.db, { ...actor, name: text(body, "name"), kind, onHand: number(body, "onHand", kind === "external_key" ? 0 : 1), marksEach: number(body, "marksEach", kind === "marks" ? 1 : 0) });
    send(response, gate(saved.result), saved);
    return;
  }
  send(response, 404, { error: "not_found", access: "denied" });
}

function gate(result: string): number {
  return result === "denied" || result === "maintenance" ? 403 : 200;
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
  const value = body[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function date(body: Record<string, unknown>, key: string): Date | null {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
