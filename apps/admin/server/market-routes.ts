import type { IncomingMessage, ServerResponse } from "node:http";

import { editIngotCurve, readMarketChart, readMarketDiagnostics, withdrawBackingMargin } from "@collective/db";

import { loadDashboard, type AdminDeps } from "./handler.js";

export async function handleMarketRoute(
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

  if (request.method === "GET" && url.pathname === "/api/market") {
    send(response, 200, { access: "allowed", ...(await readMarketDiagnostics(deps.db, guildId)) });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/market/chart") {
    send(response, 200, { access: "allowed", ...(await readMarketChart(deps.db, guildId)) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/market/curve") {
    const body = await readJson(request);
    const reason = typeof body["reason"] === "string" ? body["reason"] : "";
    const baselineMarks = typeof body["baselineMarks"] === "number" ? body["baselineMarks"] : Number.NaN;
    const spreadBps = typeof body["spreadBps"] === "number" ? body["spreadBps"] : 500;
    const quoteSeconds = typeof body["quoteSeconds"] === "number" ? body["quoteSeconds"] : 30;
    const payerUserId = typeof body["payerUserId"] === "string" ? body["payerUserId"] : current.session.userId;
    if (!reason.trim() || !Number.isInteger(baselineMarks)) {
      send(response, 400, { error: "invalid_curve", access: "allowed" });
      return;
    }
    const edited = await editIngotCurve(deps.db, {
      guildId,
      baselineMarks,
      spreadBps,
      quoteSeconds,
      payerUserId,
      actorUserId: current.session.userId,
      actorRoleIds: current.roleIds,
      reason,
      now,
    });
    send(response, edited.result === "denied" ? 403 : 200, { ...edited, access: edited.result === "denied" ? "denied" : "allowed" });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/market/withdraw") {
    const body = await readJson(request);
    const reason = typeof body["reason"] === "string" ? body["reason"] : "";
    const amountMarks = typeof body["amountMarks"] === "number" ? body["amountMarks"] : Number.NaN;
    const destinationUserId = typeof body["destinationUserId"] === "string" ? body["destinationUserId"] : "";
    if (!reason.trim() || !destinationUserId || !Number.isInteger(amountMarks)) {
      send(response, 400, { error: "invalid_withdrawal", access: "allowed" });
      return;
    }
    const withdrawn = await withdrawBackingMargin(deps.db, {
      guildId,
      destinationUserId,
      amountMarks,
      actorUserId: current.session.userId,
      actorRoleIds: current.roleIds,
      reason,
      now,
    });
    send(response, withdrawn.result === "denied" ? 403 : 200, { ...withdrawn, access: withdrawn.result === "denied" ? "denied" : "allowed" });
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
