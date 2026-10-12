import type { IncomingMessage, ServerResponse } from "node:http";

import {
  changeOperationsMaintenance,
  exportOperationsConfig,
  importOperationsDraft,
  previewOperationsImport,
  publishOperationsDraft,
  readOperations,
  recordOperationsAlert,
  rollbackOperationsConfig,
} from "@collective/db";
import { operationsSimulations } from "@collective/domain";

import { loadDashboard, type AdminDeps } from "./handler.js";

export async function handleOperationsRoute(
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
  const actor = { guildId: current.session.guildId, actorUserId: current.session.userId };

  if (request.method === "GET" && url.pathname === "/api/operations") {
    send(response, 200, await readOperations(deps.db, actor.guildId, now));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/operations/simulate") {
    send(response, 200, { access: "allowed", ...operationsSimulations() });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/operations/export") {
    const exported = await exportOperationsConfig(deps.db, actor.guildId);
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": "attachment; filename=\"collective-config.json\"",
    });
    response.end(JSON.stringify(exported));
    return;
  }
  if (request.method !== "POST") {
    send(response, 404, { error: "not_found", access: "denied" });
    return;
  }
  const body = await readJson(request);
  const reason = text(body, "reason");

  if (url.pathname === "/api/operations/preview") {
    send(response, 200, { access: "allowed", ...previewOperationsImport(body["document"]) });
    return;
  }
  if (url.pathname === "/api/operations/draft") {
    const saved = await importOperationsDraft(deps.db, { ...actor, document: body["document"], reason });
    send(response, saved.result === "draft" ? 200 : 400, { ...saved, access: "allowed" });
    return;
  }
  if (url.pathname === "/api/operations/publish") {
    const published = await publishOperationsDraft(deps.db, { ...actor, draftId: text(body, "draftId"), reason });
    send(response, published.result === "published" ? 200 : 400, { ...published, access: "allowed" });
    return;
  }
  if (url.pathname === "/api/operations/rollback") {
    const version = typeof body["version"] === "number" ? body["version"] : Number.NaN;
    const restored = await rollbackOperationsConfig(deps.db, { ...actor, version, reason, confirm: body["confirm"] === true });
    send(response, restored.result === "invalid" || restored.result === "not_found" ? 400 : 200, { ...restored, access: "allowed" });
    return;
  }
  if (url.pathname === "/api/operations/maintenance") {
    const changed = await changeOperationsMaintenance(deps.db, {
      ...actor,
      moduleKey: text(body, "moduleKey"),
      maintenance: body["maintenance"] === true,
      reason,
    });
    send(response, changed.result === "invalid" ? 400 : 200, { ...changed, access: "allowed" });
    return;
  }
  if (url.pathname === "/api/operations/alert") {
    const recorded = await recordOperationsAlert(deps.db, { ...actor, reason, now });
    send(response, recorded.result === "invalid" ? 400 : 200, { ...recorded, access: "allowed" });
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
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 70_000) {
        reject(new Error("body_too_large"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
        resolve(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function text(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}
