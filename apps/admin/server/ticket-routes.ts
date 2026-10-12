import type { IncomingMessage, ServerResponse } from "node:http";

import { listTickets, readTicketSettings, saveTicketSettings } from "@collective/db";
import { previewTicketSettings, type TicketSettingsInput } from "@collective/domain";

import { loadDashboard, type AdminDeps } from "./handler.js";

export async function handleTicketRoute(
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

  if (request.method === "GET" && url.pathname === "/api/tickets/settings") {
    const settings = await readTicketSettings(deps.db, current.session.guildId);
    send(response, 200, { access: "allowed", ...settings, grantsGeneralAccess: false });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/tickets/settings") {
    const body = await readJson(request);
    const settings = body["settings"] as TicketSettingsInput | undefined;
    const reason = typeof body["reason"] === "string" ? body["reason"] : "";
    if (!settings || !reason.trim()) {
      send(response, 400, { error: "invalid_settings", access: "allowed" });
      return;
    }
    if (body["preview"] === true) {
      const preview = previewTicketSettings(settings);
      send(response, 200, { access: "allowed", ...preview, grantsGeneralAccess: false });
      return;
    }
    const saved = await saveTicketSettings(deps.db, {
      guildId: current.session.guildId,
      settings,
      actorUserId: current.session.userId,
      reason,
    });
    send(response, 200, { ...saved, access: "allowed" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/tickets") {
    const tickets = await listTickets(deps.db, { guildId: current.session.guildId, actorUserId: current.session.userId, actorRoleIds: current.roleIds });
    send(response, 200, { ...tickets, access: "allowed" });
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
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
        resolve(parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}
