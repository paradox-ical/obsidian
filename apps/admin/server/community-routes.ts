import type { IncomingMessage, ServerResponse } from "node:http";

import { publishPanel, readCommunitySettings, reviewVerification, saveCommunitySettings } from "@collective/db";
import type { CommunitySettingsInput, RoleDescriptor } from "@collective/domain";

import { loadDashboard, type AdminDeps } from "./handler.js";

export async function handleCommunityRoute(
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

  if (request.method === "GET" && url.pathname === "/api/community/providers") {
    send(response, 200, {
      access: "allowed",
      providers: deps.env.providers.map((provider) => ({
        provider: provider.provider,
        ownershipProof: provider.ownershipProof,
        status: provider.status,
        missing: provider.missing,
      })),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/community/settings") {
    send(response, 200, {
      access: "allowed",
      settings: await readCommunitySettings(deps.db, current.session.guildId),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/community/settings") {
    const body = await readJson(request);
    const settings = body["settings"] as CommunitySettingsInput | undefined;
    const roles = Array.isArray(body["roles"]) ? (body["roles"] as RoleDescriptor[]) : [];
    const reason = typeof body["reason"] === "string" ? body["reason"] : "";
    if (!settings || !reason.trim()) {
      send(response, 400, { error: "invalid_settings", access: "allowed" });
      return;
    }
    const saved = await saveCommunitySettings(deps.db, {
      guildId: current.session.guildId,
      settings,
      roles,
      actorUserId: current.session.userId,
      reason,
    });
    send(response, saved.ok ? 200 : 400, { ...saved, access: "allowed" });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/community/verification") {
    const body = await readJson(request);
    const userId = typeof body["userId"] === "string" ? body["userId"] : "";
    const reason = typeof body["reason"] === "string" ? body["reason"] : "";
    const result = await reviewVerification(deps.db, {
      guildId: current.session.guildId,
      actorUserId: current.session.userId,
      actorRoleIds: current.roleIds,
      userId,
      reason,
      revoke: body["revoke"] === true,
      now,
    });
    send(response, result.result === "denied" ? 403 : 200, { ...result, access: result.result === "denied" ? "denied" : "allowed" });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/community/panels") {
    const body = await readJson(request);
    const reason = typeof body["reason"] === "string" ? body["reason"] : "";
    const result = await publishPanel(deps.db, {
      guildId: current.session.guildId,
      name: String(body["name"] ?? ""),
      mode: body["mode"] === "reaction" || body["mode"] === "select" ? body["mode"] : "button",
      selection: body["selection"] === "single" ? "single" : "multiple",
      options: Array.isArray(body["options"]) ? body["options"] : [],
      roles: Array.isArray(body["roles"]) ? (body["roles"] as RoleDescriptor[]) : [],
      botHighestPosition: Number(body["botHighestPosition"] ?? 0),
      actorUserId: current.session.userId,
      reason,
    });
    send(response, result.ok ? 200 : 400, { ...result, access: "allowed" });
    return;
  }

  send(response, 404, { error: "not_found", access: "allowed" });
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
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
