import type { IncomingMessage, ServerResponse } from "node:http";

import { listInviteHistory, readProgressionSettings, readPublicDossier, saveProgressionSettings } from "@collective/db";
import { previewProgressionSettings, type ProgressionSettingsInput } from "@collective/domain";

import { loadDashboard, type AdminDeps } from "./handler.js";

export async function handleProgressionRoute(
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

  if (request.method === "GET" && url.pathname === "/api/progression/settings") {
    const settings = await readProgressionSettings(deps.db, current.session.guildId);
    send(response, 200, { access: "allowed", ...settings });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/progression/settings") {
    const body = await readJson(request);
    const settings = body["settings"] as ProgressionSettingsInput | undefined;
    const reason = typeof body["reason"] === "string" ? body["reason"] : "";
    if (!settings || !reason.trim()) {
      send(response, 400, { error: "invalid_settings", access: "allowed" });
      return;
    }
    if (body["preview"] === true) {
      send(response, 200, { access: "allowed", ...previewProgressionSettings(settings) });
      return;
    }
    const saved = await saveProgressionSettings(deps.db, {
      guildId: current.session.guildId,
      settings,
      actorUserId: current.session.userId,
      reason,
    });
    send(response, 200, { ...saved, access: "allowed" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/progression/dossier") {
    const userId = url.searchParams.get("userId");
    if (!userId) {
      send(response, 400, { error: "invalid_member", access: "allowed" });
      return;
    }
    const dossier = await readPublicDossier(deps.db, current.session.guildId, userId);
    send(response, 200, { access: "allowed", dossier });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/progression/invites") {
    const history = await listInviteHistory(deps.db, { guildId: current.session.guildId, actorUserId: current.session.userId, actorRoleIds: current.roleIds });
    send(response, history.result === "denied" ? 403 : 200, { ...history, access: history.result === "denied" ? "denied" : "allowed" });
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
