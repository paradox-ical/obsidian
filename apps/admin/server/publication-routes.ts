import type { IncomingMessage, ServerResponse } from "node:http";

import { publicationPreview, validatePublicationDraft } from "@collective/domain";
import {
  actorCan,
  approvePublication,
  cancelPublicationReview,
  listPublicationTemplates,
  readPublicationBoard,
  readPublicationDraft,
  readPublicationHistory,
  requestPublicationChanges,
  savePublicationDraft,
  savePublicationTemplate,
  sendPublicationPreview,
} from "@collective/db";

import { loadDashboard, type AdminDeps } from "./handler.js";

export async function handlePublicationRoute(
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
  const actorUserId = current.session.userId;
  const actorRoleIds = current.roleIds;

  if (request.method === "GET" && url.pathname === "/api/publications") {
    const board = await readPublicationBoard(deps.db, { guildId, actorRoleIds });
    send(response, board.result === "denied" || board.result === "maintenance" ? 403 : 200, { access: board.result === "ready" ? "allowed" : "denied", ...board });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/publications/draft") {
    const draft = await readPublicationDraft(deps.db, { guildId, draftId: url.searchParams.get("id") ?? "", actorRoleIds });
    send(response, draft.result === "denied" || draft.result === "maintenance" ? 403 : 200, { access: draft.result === "ready" ? "allowed" : "denied", ...draft });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/publications/templates") {
    const templates = await listPublicationTemplates(deps.db, { guildId, actorRoleIds });
    send(response, templates.result === "denied" || templates.result === "maintenance" ? 403 : 200, { access: templates.result === "ready" ? "allowed" : "denied", ...templates });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/publications/history") {
    const history = await readPublicationHistory(deps.db, { guildId, draftId: url.searchParams.get("draft") ?? "", actorRoleIds });
    send(response, history.result === "denied" || history.result === "maintenance" ? 403 : 200, { access: history.result === "ready" ? "allowed" : "denied", ...history });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/publications/check") {
    if ((await actorCan(deps.db, { guildId, roleIds: actorRoleIds, capability: "publications" })) !== "allowed") {
      send(response, 403, { error: "denied", access: "denied" });
      return;
    }
    const body = await readJson(request);
    const validated = validatePublicationDraft(body["document"]);
    if (!validated.ok) {
      send(response, 400, { result: "invalid", errors: validated.errors, access: "allowed" });
      return;
    }
    send(response, 200, { result: "preview", preview: publicationPreview(validated.document), document: validated.document, access: "allowed" });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/publications/draft") {
    const body = await readJson(request);
    const saved = await savePublicationDraft(deps.db, {
      guildId,
      draftId: typeof body["draftId"] === "string" ? body["draftId"] : null,
      document: body["document"],
      actorUserId,
      actorRoleIds,
      now,
    });
    send(response, saved.result === "denied" || saved.result === "maintenance" ? 403 : saved.result === "invalid" ? 400 : 200, { ...saved, access: saved.result === "denied" ? "denied" : "allowed" });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/publications/template") {
    const body = await readJson(request);
    const saved = await savePublicationTemplate(deps.db, {
      guildId,
      name: typeof body["name"] === "string" ? body["name"] : "",
      document: body["document"],
      actorUserId,
      actorRoleIds,
    });
    send(response, saved.result === "denied" || saved.result === "maintenance" ? 403 : saved.result === "invalid" ? 400 : 200, { ...saved, access: saved.result === "denied" ? "denied" : "allowed" });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/publications/preview") {
    const body = await readJson(request);
    const preview = await sendPublicationPreview(deps.db, {
      guildId,
      draftId: typeof body["draftId"] === "string" ? body["draftId"] : "",
      reviewChannelId: typeof body["reviewChannelId"] === "string" ? body["reviewChannelId"] : "",
      actorUserId,
      actorRoleIds,
      now,
    });
    send(response, preview.result === "denied" || preview.result === "maintenance" ? 403 : 200, { ...preview, access: preview.result === "denied" ? "denied" : "allowed" });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/publications/approve") {
    const body = await readJson(request);
    const mode = body["mode"] === "schedule" ? "schedule" : "now";
    const scheduledFor = typeof body["scheduledFor"] === "string" ? new Date(body["scheduledFor"]) : null;
    const approved = await approvePublication(deps.db, {
      guildId,
      reviewId: typeof body["reviewId"] === "string" ? body["reviewId"] : "",
      destinationChannelId: typeof body["destinationChannelId"] === "string" ? body["destinationChannelId"] : "",
      mode,
      scheduledFor: scheduledFor && !Number.isNaN(scheduledFor.getTime()) ? scheduledFor : null,
      actorUserId,
      actorRoleIds,
      now,
    });
    send(response, approved.result === "denied" || approved.result === "maintenance" ? 403 : 200, { ...approved, access: approved.result === "denied" ? "denied" : "allowed" });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/publications/changes") {
    const body = await readJson(request);
    const changed = await requestPublicationChanges(deps.db, {
      guildId,
      reviewId: typeof body["reviewId"] === "string" ? body["reviewId"] : "",
      feedback: typeof body["feedback"] === "string" ? body["feedback"] : "",
      actorUserId,
      actorRoleIds,
      now,
    });
    send(response, changed.result === "denied" || changed.result === "maintenance" ? 403 : 200, { ...changed, access: changed.result === "denied" ? "denied" : "allowed" });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/publications/cancel") {
    const body = await readJson(request);
    const cancelled = await cancelPublicationReview(deps.db, {
      guildId,
      reviewId: typeof body["reviewId"] === "string" ? body["reviewId"] : "",
      actorUserId,
      actorRoleIds,
      now,
    });
    send(response, cancelled.result === "denied" || cancelled.result === "maintenance" ? 403 : 200, { ...cancelled, access: cancelled.result === "denied" ? "denied" : "allowed" });
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
