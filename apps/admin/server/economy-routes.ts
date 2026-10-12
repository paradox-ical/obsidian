import type { IncomingMessage, ServerResponse } from "node:http";

import {
  adjustMarks,
  bulkGrantMarks,
  economyReport,
  readEconomySettings,
  readMemberWallet,
  saveEconomySettings,
  writeAudit,
} from "@collective/db";
import { previewEconomySettings, type EconomySettingsInput } from "@collective/domain";

import { loadDashboard, type AdminDeps } from "./handler.js";

export async function handleEconomyRoute(
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

  if (request.method === "GET" && url.pathname === "/api/economy/settings") {
    send(response, 200, { access: "allowed", ...(await readEconomySettings(deps.db, guildId)) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/economy/settings") {
    const body = await readJson(request);
    const settings = body["settings"] as EconomySettingsInput | undefined;
    const reason = typeof body["reason"] === "string" ? body["reason"] : "";
    if (!settings || !reason.trim()) {
      send(response, 400, { error: "invalid_settings", access: "allowed" });
      return;
    }
    if (body["preview"] === true) {
      send(response, 200, { access: "allowed", ...previewEconomySettings(settings) });
      return;
    }
    const saved = await saveEconomySettings(deps.db, { guildId, settings, actorUserId: current.session.userId, reason });
    send(response, 200, { ...saved, access: "allowed" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/economy/wallet") {
    const userId = url.searchParams.get("userId") ?? current.session.userId;
    send(response, 200, { access: "allowed", userId, wallet: await readMemberWallet(deps.db, guildId, userId) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/economy/adjust") {
    const body = await readJson(request);
    const action = body["action"];
    const userId = typeof body["userId"] === "string" ? body["userId"] : "";
    const amountMarks = typeof body["amountMarks"] === "number" ? body["amountMarks"] : Number.NaN;
    const reason = typeof body["reason"] === "string" ? body["reason"] : "";
    if ((action !== "add" && action !== "remove" && action !== "set") || !userId || !Number.isInteger(amountMarks) || !reason.trim()) {
      send(response, 400, { error: "invalid_adjustment", access: "allowed" });
      return;
    }
    const adjusted = await adjustMarks(deps.db, {
      guildId,
      userId,
      action,
      amountMarks,
      reason,
      actorUserId: current.session.userId,
      actorRoleIds: current.roleIds,
      idempotencyKey: typeof body["idempotencyKey"] === "string" ? body["idempotencyKey"] : `adjust:${guildId}:${userId}:${reason}`,
      now,
    });
    send(response, adjusted.result === "denied" ? 403 : 200, { ...adjusted, access: adjusted.result === "denied" ? "denied" : "allowed" });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/economy/bulk") {
    const body = await readJson(request);
    const userIds = Array.isArray(body["userIds"]) ? body["userIds"].filter((userId): userId is string => typeof userId === "string") : [];
    const amountMarks = typeof body["amountMarks"] === "number" ? body["amountMarks"] : Number.NaN;
    const reason = typeof body["reason"] === "string" ? body["reason"] : "";
    if (userIds.length === 0 || !Number.isInteger(amountMarks) || !reason.trim()) {
      send(response, 400, { error: "invalid_grant", access: "allowed" });
      return;
    }
    const granted = await bulkGrantMarks(deps.db, {
      guildId,
      userIds,
      amountMarks,
      reason,
      actorUserId: current.session.userId,
      actorRoleIds: current.roleIds,
      batchId: typeof body["batchId"] === "string" ? body["batchId"] : reason,
      now,
    });
    send(response, granted.result === "denied" ? 403 : 200, { ...granted, access: granted.result === "denied" ? "denied" : "allowed" });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/stats/export") {
    const body = await readJson(request);
    const reason = typeof body["reason"] === "string" ? body["reason"] : "";
    if (!reason.trim()) {
      send(response, 400, { error: "invalid_reason", access: "allowed" });
      return;
    }
    const report = await economyReport(deps.db, guildId);
    await writeAudit(deps.db, {
      guildId,
      actorUserId: current.session.userId,
      action: "economy.export",
      targetType: "ledger",
      targetId: guildId,
      reason,
    });
    send(response, 200, { result: "exported", report, access: "allowed" });
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
