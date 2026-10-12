import type { IncomingMessage, ServerResponse } from "node:http";

import { clearCharacterCooldown, readCharacterStaff, saveCharacterCurve, saveClassDefinition } from "@collective/db";

import { loadDashboard, type AdminDeps } from "./handler.js";

export async function handleCharacterRoute(request: IncomingMessage, response: ServerResponse, deps: AdminDeps, now: Date, url: URL): Promise<void> {
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
  if (request.method === "GET" && url.pathname === "/api/characters") {
    send(response, 200, await readCharacterStaff(deps.db, actor.guildId, now));
    return;
  }
  if (request.method !== "POST") {
    send(response, 404, { error: "not_found", access: "denied" });
    return;
  }
  const body = await readJson(request);
  if (url.pathname === "/api/characters/curve") {
    const saved = await saveCharacterCurve(deps.db, { ...actor, xpFactor: number(body, "xpFactor"), sessionXp: number(body, "sessionXp"), sessionsPerWeek: number(body, "sessionsPerWeek") });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/characters/class") {
    const saved = await saveClassDefinition(deps.db, {
      ...actor,
      classId: text(body, "classId"),
      summary: text(body, "summary"),
      baseStrength: number(body, "baseStrength"),
      baseAgility: number(body, "baseAgility"),
      baseEndurance: number(body, "baseEndurance"),
      baseFocus: number(body, "baseFocus"),
    });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/characters/cooldown") {
    const saved = await clearCharacterCooldown(deps.db, { ...actor, userId: text(body, "userId"), reason: text(body, "reason") || "Staff cooldown correction" });
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

function number(body: Record<string, unknown>, key: string): number {
  return typeof body[key] === "number" ? body[key] : Number(body[key] ?? 0);
}
