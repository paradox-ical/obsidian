import type { IncomingMessage, ServerResponse } from "node:http";

import { cancelBlackjack, fundBlackjackBankroll, readBlackjackStaff, saveBlackjackSettings } from "@collective/db";

import { loadDashboard, type AdminDeps } from "./handler.js";

export async function handleBlackjackRoute(request: IncomingMessage, response: ServerResponse, deps: AdminDeps, now: Date, url: URL): Promise<void> {
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
  if (request.method === "GET" && url.pathname === "/api/blackjack") {
    send(response, 200, await readBlackjackStaff(deps.db, actor.guildId));
    return;
  }
  if (request.method !== "POST") {
    send(response, 404, { error: "not_found", access: "denied" });
    return;
  }
  const body = await readJson(request);
  if (url.pathname === "/api/blackjack/settings") {
    const saved = await saveBlackjackSettings(deps.db, {
      ...actor,
      ...(has(body, "minBetMarks") ? { minBetMarks: number(body, "minBetMarks") } : {}),
      ...(has(body, "maxBetMarks") ? { maxBetMarks: number(body, "maxBetMarks") } : {}),
      ...(has(body, "tableCap") ? { tableCap: number(body, "tableCap") } : {}),
      ...(has(body, "joinSeconds") ? { joinSeconds: number(body, "joinSeconds") } : {}),
      ...(has(body, "turnSeconds") ? { turnSeconds: number(body, "turnSeconds") } : {}),
      ...(has(body, "hitSoft17") ? { hitSoft17: body["hitSoft17"] === true } : {}),
      ...(has(body, "naturalNum") ? { naturalNum: number(body, "naturalNum") } : {}),
      ...(has(body, "naturalDen") ? { naturalDen: number(body, "naturalDen") } : {}),
      ...(has(body, "regularNum") ? { regularNum: number(body, "regularNum") } : {}),
      ...(has(body, "regularDen") ? { regularDen: number(body, "regularDen") } : {}),
      ...(has(body, "maxSplits") ? { maxSplits: number(body, "maxSplits") } : {}),
      now,
    });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/blackjack/fund") {
    const saved = await fundBlackjackBankroll(deps.db, {
      ...actor,
      amountMarks: number(body, "amountMarks"),
      idempotencyKey: text(body, "idempotencyKey"),
      reason: text(body, "reason"),
      now,
    });
    send(response, gate(saved.result), saved);
    return;
  }
  if (url.pathname === "/api/blackjack/cancel") {
    const saved = await cancelBlackjack(deps.db, { ...actor, tableId: text(body, "tableId"), reason: text(body, "reason"), now });
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
  return body[key] !== undefined;
}

function text(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

function number(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  return typeof value === "number" ? value : Number.NaN;
}
