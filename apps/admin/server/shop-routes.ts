import type { IncomingMessage, ServerResponse } from "node:http";

import { importSteamKey, readShopStaff, reviewRefund, saveCrateTable, saveShopOffer } from "@collective/db";

import { loadDashboard, type AdminDeps } from "./handler.js";

export async function handleShopRoute(request: IncomingMessage, response: ServerResponse, deps: AdminDeps, now: Date, url: URL): Promise<void> {
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
  if (request.method === "GET" && url.pathname === "/api/shop") {
    send(response, 200, await readShopStaff(deps.db, actor.guildId));
    return;
  }
  if (request.method !== "POST") {
    send(response, 404, { error: "not_found", access: "denied" });
    return;
  }
  const body = await readJson(request);
  if (url.pathname === "/api/shop/offer") {
    const saved = await saveShopOffer(deps.db, {
      ...actor,
      slug: text(body, "slug"),
      name: text(body, "name"),
      shop: text(body, "shop"),
      currency: text(body, "currency"),
      price: number(body, "price"),
      stock: number(body, "stock"),
      limitPerMember: number(body, "limitPerMember"),
      minLevel: number(body, "minLevel"),
      requiredRoleId: text(body, "requiredRoleId"),
      classSlug: text(body, "classSlug"),
      deliverable: text(body, "deliverable"),
      deliverableSlug: text(body, "deliverableSlug"),
      amount: number(body, "amount"),
      duplicatePolicy: text(body, "duplicatePolicy") || "keep",
    });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/shop/crate") {
    const entries = Array.isArray(body["entries"]) ? body["entries"].flatMap(entryOf) : [];
    const saved = await saveCrateTable(deps.db, { ...actor, slug: text(body, "slug"), name: text(body, "name"), currency: text(body, "currency"), price: number(body, "price"), pityThreshold: number(body, "pityThreshold"), guaranteeSlug: text(body, "guaranteeSlug"), replacesSlug: text(body, "replacesSlug"), entries });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/shop/key") {
    const saved = await importSteamKey(deps.db, { ...actor, offerSlug: text(body, "offerSlug"), keyMaterial: text(body, "keyMaterial"), now });
    send(response, gate(saved.result), { result: saved.result, ...(saved.result === "stocked" ? { id: saved.id } : {}) });
    return;
  }
  if (url.pathname === "/api/shop/refund") {
    const saved = await reviewRefund(deps.db, { ...actor, purchaseId: text(body, "purchaseId"), now });
    send(response, gate(saved.result), saved);
    return;
  }
  send(response, 404, { error: "not_found", access: "denied" });
}

function entryOf(value: unknown): Array<{ slug: string; kind: string; weight: number; amount: number; duplicatePolicy: string; guarantee: boolean }> {
  if (!value || typeof value !== "object") {
    return [];
  }
  const row = value as Record<string, unknown>;
  return [{ slug: text(row, "slug"), kind: text(row, "kind"), weight: number(row, "weight"), amount: number(row, "amount"), duplicatePolicy: text(row, "duplicatePolicy") || "keep", guarantee: row["guarantee"] === true }];
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

function text(body: Record<string, unknown>, key: string): string {
  return typeof body[key] === "string" ? body[key] : "";
}

function number(body: Record<string, unknown>, key: string): number {
  return typeof body[key] === "number" ? body[key] : Number(body[key] ?? 0);
}
