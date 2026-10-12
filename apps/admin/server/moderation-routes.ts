import type { IncomingMessage, ServerResponse } from "node:http";

import { listCases, readModerationPolicy, saveModerationPolicy } from "@collective/db";
import { preparePolicy, previewRules, type MessageSignal, type ModerationPolicyInput } from "@collective/domain";

import { loadDashboard, type AdminDeps } from "./handler.js";

export async function handleModerationRoute(
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

  if (request.method === "GET" && url.pathname === "/api/moderation/policy") {
    const policy = await readModerationPolicy(deps.db, current.session.guildId);
    send(response, 200, { access: "allowed", ...policy, automaticBan: false });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/moderation/policy") {
    const body = await readJson(request);
    const policy = body["policy"] as ModerationPolicyInput | undefined;
    const reason = typeof body["reason"] === "string" ? body["reason"] : "";
    if (!policy || !reason.trim()) {
      send(response, 400, { error: "invalid_policy", access: "allowed" });
      return;
    }
    const sample = body["sample"] as MessageSignal | undefined;
    const prepared = preparePolicy(policy);
    if (body["preview"] === true) {
      send(response, 200, {
        access: "allowed",
        persisted: false,
        automaticBan: false,
        banRemoved: prepared.banRemoved,
        policy: prepared.policy,
        ...(sample ? { evaluation: previewRules(prepared.policy, sample) } : {}),
      });
      return;
    }
    const saved = await saveModerationPolicy(deps.db, {
      guildId: current.session.guildId,
      policy,
      actorUserId: current.session.userId,
      reason,
    });
    send(response, 200, { ...saved, access: "allowed", automaticBan: false });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/moderation/cases") {
    const cases = await listCases(deps.db, { guildId: current.session.guildId, actorRoleIds: current.roleIds });
    send(response, cases.result === "denied" ? 403 : 200, { ...cases, access: cases.result === "denied" ? "denied" : "allowed" });
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
