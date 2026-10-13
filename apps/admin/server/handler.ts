import type { IncomingMessage, ServerResponse } from "node:http";

import {
  consumeOauthState,
  createAdminSession,
  createOauthState,
  dashboardDecision,
  economyReport,
  readAdminSession,
  registerAuthAttempt,
  revokeAdminSession,
  type PrismaClient,
} from "@collective/db";
import {
  createAdminHealthReport,
  discordAuthorizeUrl,
  oauthReadiness,
  sha256,
  type AppEnv,
} from "@collective/domain";

import { handleCommunityRoute } from "./community-routes.js";
import { handleModerationRoute } from "./moderation-routes.js";
import { handleTicketRoute } from "./ticket-routes.js";
import { handleProgressionRoute } from "./progression-routes.js";
import { handleEconomyRoute } from "./economy-routes.js";
import { handleMarketRoute } from "./market-routes.js";
import { handlePublicationRoute } from "./publication-routes.js";
import { handleDistributionRoute } from "./distribution-routes.js";
import { handleActivityRoute } from "./activity-routes.js";
import { handleCharacterRoute } from "./character-routes.js";
import { handleCombatRoute } from "./combat-routes.js";
import { handleWorldRoute } from "./world-routes.js";
import { handleShopRoute } from "./shop-routes.js";
import { handleLotteryRoute } from "./lottery-routes.js";
import { handleDeadDropRoute } from "./dead-drop-routes.js";
import { handleBlackjackRoute } from "./blackjack-routes.js";
import { handleOperationsRoute } from "./operations-routes.js";
import { handleContractRoute } from "./contract-routes.js";
import { handleGatheringRoute } from "./gathering-routes.js";
import { handleSeasonRoute } from "./season-routes.js";
import { handleAccessRoute } from "./access-routes.js";
import type { DiscordDirectory } from "./directory.js";

const SESSION_COOKIE = "collective_session";
const SESSION_SECONDS = 12 * 60 * 60;

export interface AdminDeps {
  env: AppEnv;
  db: PrismaClient;
  directory: DiscordDirectory;
  guildId?: string;
  now?: () => Date;
  attemptLimit?: number;
}

export async function handleAdminRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: AdminDeps,
): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const now = (deps.now ?? (() => new Date()))();
  const oauth = oauthReadiness(deps.env);

  if (request.method === "GET" && url.pathname === "/health") {
    send(response, 200, createAdminHealthReport({ oauthConfigured: oauth === "oauth_ready" }));
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/status") {
    await sendStatus(request, response, deps, now, oauth);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/auth/discord") {
    await startLogin(request, response, deps, now, oauth);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/auth/discord/callback") {
    await finishLogin(request, response, deps, now, oauth, url);
    return true;
  }

  if (url.pathname === "/auth/logout") {
    if (request.method !== "POST") {
      send(response, 405, { error: "method_not_allowed", access: "denied" });
      return true;
    }
    await logout(request, response, deps, now);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/stats") {
    await sendStats(request, response, deps, now);
    return true;
  }

  if (url.pathname.startsWith("/api/access")) {
    await handleAccessRoute(request, response, deps, now, url);
    return true;
  }

  if (url.pathname.startsWith("/api/community")) {
    await handleCommunityRoute(request, response, deps, now, url);
    return true;
  }

  if (url.pathname.startsWith("/api/moderation")) {
    await handleModerationRoute(request, response, deps, now, url);
    return true;
  }

  if (url.pathname.startsWith("/api/tickets")) {
    await handleTicketRoute(request, response, deps, now, url);
    return true;
  }

  if (url.pathname.startsWith("/api/progression")) {
    await handleProgressionRoute(request, response, deps, now, url);
    return true;
  }

  if (url.pathname.startsWith("/api/market")) {
    await handleMarketRoute(request, response, deps, now, url);
    return true;
  }

  if (url.pathname.startsWith("/api/publications")) {
    await handlePublicationRoute(request, response, deps, now, url);
    return true;
  }

  if (url.pathname.startsWith("/api/distribution")) {
    await handleDistributionRoute(request, response, deps, now, url);
    return true;
  }

  if (url.pathname.startsWith("/api/gatherings")) {
    await handleGatheringRoute(request, response, deps, now, url);
    return true;
  }

  if (url.pathname.startsWith("/api/activities")) {
    await handleActivityRoute(request, response, deps, now, url);
    return true;
  }

  if (url.pathname.startsWith("/api/contracts")) {
    await handleContractRoute(request, response, deps, now, url);
    return true;
  }

  if (url.pathname.startsWith("/api/characters")) {
    await handleCharacterRoute(request, response, deps, now, url);
    return true;
  }

  if (url.pathname.startsWith("/api/combat")) {
    await handleCombatRoute(request, response, deps, now, url);
    return true;
  }

  if (url.pathname.startsWith("/api/world")) {
    await handleWorldRoute(request, response, deps, now, url);
    return true;
  }

  if (url.pathname.startsWith("/api/shop")) {
    await handleShopRoute(request, response, deps, now, url);
    return true;
  }

  if (url.pathname.startsWith("/api/lottery")) {
    await handleLotteryRoute(request, response, deps, now, url);
    return true;
  }

  if (url.pathname.startsWith("/api/dead-drop")) {
    await handleDeadDropRoute(request, response, deps, now, url);
    return true;
  }
  if (url.pathname.startsWith("/api/blackjack")) {
    await handleBlackjackRoute(request, response, deps, now, url);
    return true;
  }
  if (url.pathname.startsWith("/api/operations")) {
    await handleOperationsRoute(request, response, deps, now, url);
    return true;
  }

  if (url.pathname.startsWith("/api/economy") || url.pathname === "/api/stats/export") {
    await handleEconomyRoute(request, response, deps, now, url);
    return true;
  }

  if (url.pathname.startsWith("/api/seasons") || url.pathname.startsWith("/api/leaderboards") || url.pathname.startsWith("/api/polls") || url.pathname.startsWith("/api/rooms")) {
    await handleSeasonRoute(request, response, deps, now, url);
    return true;
  }

  return false;
}

async function startLogin(
  request: IncomingMessage,
  response: ServerResponse,
  deps: AdminDeps,
  now: Date,
  oauth: "setup_required" | "oauth_ready",
) {
  if (oauth !== "oauth_ready" || !deps.guildId || !deps.env.discord.applicationId) {
    send(response, 503, { status: "setup_required", access: "denied" });
    return;
  }
  const attempt = await registerAuthAttempt(
    deps.db,
    sha256(`oauth-start:${request.socket.remoteAddress ?? "unknown"}`),
    now,
    deps.attemptLimit ?? 10,
  );
  if (!attempt.allowed) {
    send(response, 429, { error: "rate_limited", access: "denied" });
    return;
  }
  const state = await createOauthState(deps.db, now);
  const location = discordAuthorizeUrl({
    applicationId: deps.env.discord.applicationId,
    redirectUri: callbackUrl(deps.env),
    state,
  });
  response.writeHead(302, {
    location,
    "cache-control": "no-store",
  });
  response.end();
}

async function finishLogin(
  request: IncomingMessage,
  response: ServerResponse,
  deps: AdminDeps,
  now: Date,
  oauth: "setup_required" | "oauth_ready",
  url: URL,
) {
  if (oauth !== "oauth_ready" || !deps.guildId) {
    send(response, 503, { status: "setup_required", access: "denied" });
    return;
  }
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const stateOk = state ? await consumeOauthState(deps.db, state, now) : false;
  if (!stateOk || !code) {
    refuseLogin(response, deps.env, "invalid_state");
    return;
  }
  let exchanged: { userId: string } | null;
  try {
    exchanged = await deps.directory.exchange(code);
  } catch {
    refuseLogin(response, deps.env, "directory_unavailable");
    return;
  }
  const userId = exchanged?.userId ?? null;
  if (!userId) {
    refuseLogin(response, deps.env, "invalid_code");
    return;
  }
  const allowed = await allowDashboard(deps, deps.guildId, userId);
  if (!allowed.ok) {
    refuseLogin(response, deps.env, allowed.error);
    return;
  }
  const session = await createAdminSession(deps.db, {
    userId,
    guildId: deps.guildId,
    expiresAt: new Date(now.getTime() + SESSION_SECONDS * 1000),
  });
  response.writeHead(302, {
    location: "/",
    "set-cookie": sessionCookie(session.token, deps.env.adminOrigin, SESSION_SECONDS),
    "cache-control": "no-store",
  });
  response.end();
}

async function sendStatus(
  request: IncomingMessage,
  response: ServerResponse,
  deps: AdminDeps,
  now: Date,
  oauth: "setup_required" | "oauth_ready",
) {
  const token = readCookie(request.headers.cookie, SESSION_COOKIE);
  if (!token) {
    send(response, 200, { authenticated: false, oauth, access: "denied", redirectUri: callbackUrl(deps.env) });
    return;
  }
  const current = await currentDashboard(deps, token, now);
  if (!current.ok) {
    send(response, 403, { authenticated: false, oauth, access: "denied", reason: current.reason });
    return;
  }
  send(response, 200, {
    authenticated: true,
    oauth,
    access: "allowed",
    userId: current.session.userId,
    csrfToken: current.session.csrfToken,
  });
}

async function sendStats(request: IncomingMessage, response: ServerResponse, deps: AdminDeps, now: Date) {
  const token = readCookie(request.headers.cookie, SESSION_COOKIE);
  if (!token) {
    send(response, 403, { error: "denied", access: "denied" });
    return;
  }
  const current = await currentDashboard(deps, token, now);
  if (!current.ok) {
    send(response, 403, { error: "denied", access: "denied", reason: current.reason });
    return;
  }
  const report = await economyReport(deps.db, current.session.guildId);
  send(response, 200, { module: "statistics", status: "ready", access: "allowed", report });
}

async function logout(request: IncomingMessage, response: ServerResponse, deps: AdminDeps, now: Date) {
  const token = readCookie(request.headers.cookie, SESSION_COOKIE);
  const session = token ? await readAdminSession(deps.db, token, now) : null;
  const csrf = request.headers["x-csrf-token"];
  if (!session || typeof csrf !== "string" || csrf !== session.csrfToken) {
    send(response, 403, { error: "denied", access: "denied" });
    return;
  }
  await revokeAdminSession(deps.db, token ?? "", now);
  send(response, 200, { access: "denied", authenticated: false }, {
    "set-cookie": sessionCookie("", deps.env.adminOrigin, 0),
  });
}

export async function loadDashboard(request: IncomingMessage, deps: AdminDeps, now: Date) {
  const token = readCookie(request.headers.cookie, SESSION_COOKIE);
  if (!token) {
    return { ok: false as const, reason: "session" };
  }
  return currentDashboard(deps, token, now);
}

async function currentDashboard(deps: AdminDeps, token: string, now: Date) {
  const session = await readAdminSession(deps.db, token, now);
  if (!session) {
    return { ok: false as const, reason: "session" };
  }
  const allowed = await allowDashboard(deps, session.guildId, session.userId);
  if (!allowed.ok) {
    await revokeAdminSession(deps.db, token, now);
    return { ok: false as const, reason: allowed.error };
  }
  return { ok: true as const, session, roleIds: allowed.roleIds };
}

async function allowDashboard(deps: AdminDeps, guildId: string, userId: string) {
  let member: { roleIds: string[] } | null;
  try {
    member = await deps.directory.member(guildId, userId);
  } catch {
    return { ok: false as const, status: 503, error: "directory_unavailable" };
  }
  if (!member) {
    return { ok: false as const, status: 403, error: "not_a_member" };
  }
  const decision = await dashboardDecision(deps.db, { guildId, userId, roleIds: member.roleIds });
  if (decision === "denied") {
    return { ok: false as const, status: 403, error: "denied" };
  }
  return { ok: true as const, roleIds: member.roleIds };
}

function refuseLogin(response: ServerResponse, env: AppEnv, reason: string): void {
  const location = new URL(env.adminOrigin);
  location.pathname = "/";
  location.searchParams.set("sign-in", reason);
  response.writeHead(302, {
    location: location.toString(),
    "cache-control": "no-store",
  });
  response.end();
}

function callbackUrl(env: AppEnv): string {
  return `${env.adminOrigin}/auth/discord/callback`;
}

function sessionCookie(token: string, origin: string, maxAge: number): string {
  const secure = origin.startsWith("https://") ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

function send(response: ServerResponse, status: number, body: unknown, extra?: Record<string, string>): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extra,
  });
  response.end(JSON.stringify(body));
}
