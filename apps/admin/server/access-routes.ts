import type { IncomingMessage, ServerResponse } from "node:http";

import { grantCapability } from "@collective/db";
import { CAPABILITIES, isCapability } from "@collective/domain";

import { loadDashboard, type AdminDeps } from "./handler.js";

const SNOWFLAKE = /^[0-9]{17,20}$/;

export async function handleAccessRoute(
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
  const guild = await deps.db.guild.findUnique({ where: { guildId: current.session.guildId } });
  const owner = guild?.ownerUserId === current.session.userId;
  if (!owner) {
    send(response, request.method === "GET" ? 200 : 403, {
      access: request.method === "GET" ? "allowed" : "denied",
      owner: false,
      capabilities: [],
      grants: [],
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/access/capabilities") {
    const grants = await deps.db.capabilityGrant.findMany({
      where: { guildId: current.session.guildId },
      orderBy: [{ roleId: "asc" }, { capability: "asc" }],
    });
    send(response, 200, {
      access: "allowed",
      owner: true,
      capabilities: CAPABILITIES,
      grants: grants.map((grant) => ({ roleId: grant.roleId, capability: grant.capability })),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/access/capabilities") {
    const body = await readJson(request);
    const roleId = typeof body["roleId"] === "string" ? body["roleId"].trim() : "";
    const capability = typeof body["capability"] === "string" ? body["capability"] : "";
    const reason = typeof body["reason"] === "string" ? body["reason"].trim() : "";
    if (!SNOWFLAKE.test(roleId) || !isCapability(capability) || !reason) {
      send(response, 400, { error: "invalid_grant", access: "allowed", owner: true });
      return;
    }
    const granted = await grantCapability(deps.db, {
      guildId: current.session.guildId,
      roleId,
      capability,
      actorUserId: current.session.userId,
      reason,
    });
    send(response, 200, { access: "allowed", owner: true, roleId: granted.roleId, capability: granted.capability });
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
