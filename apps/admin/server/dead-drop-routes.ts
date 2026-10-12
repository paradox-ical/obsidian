import type { IncomingMessage, ServerResponse } from "node:http";

import { cancelDeadDrop, fundDeadDropBudget, inspectDeadDrop, pauseDeadDrop, readDeadDropStaff, resumeDeadDrop, saveDeadDropSettings, saveDeadDropSpecial } from "@collective/db";

import { loadDashboard, type AdminDeps } from "./handler.js";

export async function handleDeadDropRoute(request: IncomingMessage, response: ServerResponse, deps: AdminDeps, now: Date, url: URL): Promise<void> {
  const current = await loadDashboard(request, deps, now);
  if (!current.ok) {
    send(response, 403, { error: "denied", access: "denied" });
    return;
  }
  if (request.method !== "GET" && request.headers["x-csrf-token"] !== current.session.csrfToken) {
    send(response, 403, { error: "denied", access: "denied" });
    return;
  }
  const actor = { guildId: current.session.guildId, actorUserId: current.session.userId, actorRoleIds: current.roleIds };
  if (request.method === "GET" && url.pathname === "/api/dead-drop") {
    send(response, 200, await readDeadDropStaff(deps.db, actor.guildId));
    return;
  }
  if (request.method !== "POST") {
    send(response, 404, { error: "not_found", access: "denied" });
    return;
  }
  const body = await readJson(request);
  if (url.pathname === "/api/dead-drop/settings") {
    const saved = await saveDeadDropSettings(deps.db, {
      ...actor,
      ...(has(body, "pickMarks") ? { pickMarks: number(body, "pickMarks") } : {}),
      ...(has(body, "seedMarks") ? { seedMarks: number(body, "seedMarks") } : {}),
      ...(has(body, "smallMarks") ? { smallMarks: number(body, "smallMarks") } : {}),
      ...(has(body, "smallCount") ? { smallCount: number(body, "smallCount") } : {}),
      ...(has(body, "shareBps") ? { shareBps: number(body, "shareBps") } : {}),
      ...(body["clearClock"] === true ? { clearClock: true } : {}),
      ...(has(body, "hour") ? { hour: body["hour"] === null ? null : number(body, "hour") } : {}),
      ...(has(body, "minute") ? { minute: body["minute"] === null ? null : number(body, "minute") } : {}),
      now,
    });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/dead-drop/fund") {
    const pool = text(body, "pool");
    const saved = await fundDeadDropBudget(deps.db, {
      ...actor,
      pool: pool === "small" ? "small" : "seed",
      amountMarks: number(body, "amountMarks"),
      idempotencyKey: text(body, "idempotencyKey"),
      reason: text(body, "reason"),
      now,
    });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/dead-drop/special") {
    const saved = await saveDeadDropSpecial(deps.db, { ...actor, kind: text(body, "kind"), payload: text(body, "payload"), reason: text(body, "reason"), now });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/dead-drop/pause") {
    const saved = await pauseDeadDrop(deps.db, { ...actor, reason: text(body, "reason"), now });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/dead-drop/resume") {
    const saved = await resumeDeadDrop(deps.db, { ...actor, reason: text(body, "reason"), now });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/dead-drop/cancel") {
    const saved = await cancelDeadDrop(deps.db, { ...actor, reason: text(body, "reason"), now });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/dead-drop/inspect") {
    const saved = await inspectDeadDrop(deps.db, { ...actor, reason: text(body, "reason") });
    send(response, gate(saved.result), saved);
    return;
  }
  send(response, 404, { error: "not_found", access: "denied" });
}

function gate(result: string): number {
  return result === "denied" || result === "maintenance" || result === "setup_required" ? 403 : 200;
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

function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function text(body: Record<string, unknown>, key: string): string {
  return typeof body[key] === "string" ? body[key] : "";
}

function number(body: Record<string, unknown>, key: string): number {
  return typeof body[key] === "number" ? body[key] : Number(body[key] ?? 0);
}
