import type { IncomingMessage, ServerResponse } from "node:http";

import {
  approveContract,
  assignContract,
  readContractStaff,
  rejectContract,
  saveContractObjective,
  saveContractPreference,
  saveContractSettings,
} from "@collective/db";

import { loadDashboard, type AdminDeps } from "./handler.js";

export async function handleContractRoute(
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
  if (request.method === "GET" && url.pathname === "/api/contracts") {
    const board = await readContractStaff(deps.db, { guildId: actor.guildId, actorRoleIds: actor.actorRoleIds, now });
    send(response, gate(board.result), board);
    return;
  }
  if (request.method !== "POST") {
    send(response, 404, { error: "not_found", access: "denied" });
    return;
  }
  const body = await readJson(request);
  if (url.pathname === "/api/contracts/objective") {
    const saved = await saveContractObjective(deps.db, {
      ...actor,
      ...(text(body, "id") ? { id: text(body, "id") } : {}),
      title: text(body, "title"),
      prompt: text(body, "prompt"),
      kind: text(body, "kind"),
      band: text(body, "band"),
      target: number(body, "target", 1),
      rewardMarks: number(body, "rewardMarks", 0),
      answer: text(body, "answer"),
      dailyPool: bool(body, "dailyPool"),
      weeklyPool: bool(body, "weeklyPool"),
      monthlyPool: bool(body, "monthlyPool"),
      policy: text(body, "policy") === "migrate" ? "migrate" : "preserve",
    });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/contracts/assign") {
    const saved = await assignContract(deps.db, {
      ...actor,
      userId: text(body, "userId") || actor.actorUserId,
      definitionId: text(body, "definitionId"),
      board: text(body, "board") || "daily",
    });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/contracts/approve") {
    const saved = await approveContract(deps.db, { ...actor, submissionId: text(body, "submissionId") });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/contracts/reject") {
    const saved = await rejectContract(deps.db, { ...actor, submissionId: text(body, "submissionId"), reason: text(body, "reason") || "Rejected" });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/contracts/settings") {
    const saved = await saveContractSettings(deps.db, {
      ...actor,
      ...(text(body, "timezone") ? { timezone: text(body, "timezone") } : {}),
      completionChannelId: text(body, "completionChannelId"),
    });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/contracts/preference") {
    const saved = await saveContractPreference(deps.db, {
      guildId: actor.guildId,
      userId: text(body, "userId") || actor.actorUserId,
      ...(typeof body["refreshDaily"] === "boolean" ? { refreshDaily: body["refreshDaily"] } : {}),
      ...(typeof body["refreshWeekly"] === "boolean" ? { refreshWeekly: body["refreshWeekly"] } : {}),
      ...(typeof body["refreshMonthly"] === "boolean" ? { refreshMonthly: body["refreshMonthly"] } : {}),
      ...(text(body, "delivery") ? { delivery: text(body, "delivery") } : {}),
      ...(text(body, "channelId") ? { channelId: text(body, "channelId") } : {}),
      ...(typeof body["completionPings"] === "boolean" ? { completionPings: body["completionPings"] } : {}),
      now,
    });
    send(response, gate(saved.result), saved);
    return;
  }
  send(response, 404, { error: "not_found", access: "denied" });
}

function gate(result: string): number {
  return result === "denied" || result === "maintenance" ? 403 : 200;
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
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
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Math.trunc(Number(value));
  return fallback;
}

function bool(body: Record<string, unknown>, key: string): boolean {
  return body[key] === true;
}
