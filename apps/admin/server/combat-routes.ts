import type { IncomingMessage, ServerResponse } from "node:http";

import { readCombatStaff, readWorkshopStaff, saveGearTemplate, saveRecipe, saveTestOpponent, saveWorkshopCaps } from "@collective/db";

import { loadDashboard, type AdminDeps } from "./handler.js";

export async function handleCombatRoute(request: IncomingMessage, response: ServerResponse, deps: AdminDeps, now: Date, url: URL): Promise<void> {
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
  if (request.method === "GET" && url.pathname === "/api/combat") {
    const staff = await readCombatStaff(deps.db, actor.guildId);
    const workshop = await readWorkshopStaff(deps.db, actor.guildId);
    send(response, 200, { ...staff, workshop });
    return;
  }
  if (request.method !== "POST") {
    send(response, 404, { error: "not_found", access: "denied" });
    return;
  }
  const body = await readJson(request);
  if (url.pathname === "/api/combat/template") {
    const saved = await saveGearTemplate(deps.db, { ...actor, templateId: text(body, "templateId"), summary: text(body, "summary"), level: number(body, "level"), classSlug: text(body, "classSlug"), affixMax: number(body, "affixMax") });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/combat/workshop") {
    const saved = await saveWorkshopCaps(deps.db, { ...actor, upgradeCap: number(body, "upgradeCap"), listingLimit: number(body, "listingLimit"), listingHours: number(body, "listingHours"), listingFeeMarks: number(body, "listingFeeMarks"), rerollBaseMarks: number(body, "rerollBaseMarks") });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/combat/recipe") {
    const saved = await saveRecipe(deps.db, { ...actor, slug: text(body, "slug"), name: text(body, "name"), outputSlug: text(body, "outputSlug"), inputAmount: number(body, "inputAmount"), affixSlug: text(body, "affixSlug"), affixStat: text(body, "affixStat"), affixAmount: number(body, "affixAmount") });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/combat/opponent") {
    const saved = await saveTestOpponent(deps.db, { ...actor, opponentId: text(body, "opponentId"), health: number(body, "health") });
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
