import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { createPrismaClient } from "@collective/db";
import { parseEnv } from "@collective/domain";
import { afterAll, describe, expect, it } from "vitest";

import type { DiscordDirectory } from "./directory.js";
import { handleAdminRequest } from "./handler.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const ownerId = "owner-user";
const moderatorId = "moderator-user";
const memberId = "member-user";
const adminRoleId = "admin-role";
const startedAt = new Date();

const members = new Map<string, { userId: string; roleIds: string[] } | null>([
  [ownerId, { userId: ownerId, roleIds: [] }],
  [moderatorId, { userId: moderatorId, roleIds: ["mod-role"] }],
  [memberId, { userId: memberId, roleIds: [] }],
  ["role-admin", { userId: "role-admin", roleIds: [adminRoleId] }],
]);

const directory: DiscordDirectory = {
  async exchange(code) {
    const userId = code.replace(/-code$/, "");
    return members.has(userId) ? { userId } : null;
  },
  async member(_guildId, userId) {
    return members.get(userId) ?? null;
  },
};

const env = parseEnv({
  DATABASE_URL: databaseUrl,
  DISCORD_TOKEN: "bot-token",
  DISCORD_APPLICATION_ID: "123456789012345678",
  DISCORD_CLIENT_SECRET: "client-secret",
  ADMIN_ORIGIN: "http://127.0.0.1:5173",
});

const server = createServer((request, response) => {
  void handleAdminRequest(request, response, {
    env,
    db,
    directory,
    guildId,
    attemptLimit: 100,
  });
});

async function listen(): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

const baseUrl = await listen();

afterAll(async () => {
  server.close();
  await db.adminSession.deleteMany({ where: { guildId } });
  await db.dashboardGrant.deleteMany({ where: { guildId } });
  await db.capabilityGrant.deleteMany({ where: { guildId } });
  await db.auditRecord.deleteMany({ where: { guildId } });
  await db.guild.deleteMany({ where: { guildId } });
  await db.oauthState.deleteMany({ where: { createdAt: { gte: startedAt } } });
  await db.authAttempt.deleteMany({ where: { windowStart: { gte: new Date(startedAt.getTime() - 60_000) } } });
  await db.$disconnect();
});

async function login(code: string): Promise<Response> {
  const start = await fetch(`${baseUrl}/auth/discord`, { redirect: "manual" });
  expect(start.status).toBe(302);
  const location = start.headers.get("location");
  if (!location) {
    throw new Error("Login did not redirect.");
  }
  const state = new URL(location).searchParams.get("state");
  return fetch(`${baseUrl}/auth/discord/callback?code=${code}&state=${state}`, { redirect: "manual" });
}

function sessionCookie(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  const pair = header.split(";")[0] ?? "";
  if (!pair.startsWith("collective_session=")) {
    throw new Error("Session cookie was not set.");
  }
  return pair;
}

describe("admin authentication boundaries", () => {
  it("does not store OAuth state when credentials are missing", async () => {
    const before = await db.oauthState.count();
    const closed = parseEnv({ DATABASE_URL: databaseUrl, ADMIN_ORIGIN: "http://127.0.0.1:5173" });
    const closedServer = createServer((request, response) => {
      void handleAdminRequest(request, response, { env: closed, db, directory, guildId });
    });
    await new Promise<void>((resolve) => {
      closedServer.listen(0, "127.0.0.1", () => resolve());
    });
    const address = closedServer.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/auth/discord`, { redirect: "manual" });
    const body = (await response.json()) as { status?: string };
    closedServer.close();
    expect(response.status).toBe(503);
    expect(body.status).toBe("setup_required");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await db.oauthState.count()).toBe(before);
  });

  it("denies members and moderators, admits the owner, and drops access when a role is removed", async () => {
    await db.guild.create({
      data: { guildId, ownerUserId: ownerId, updatedAt: new Date() },
    });
    await db.capabilityGrant.create({
      data: { id: randomUUID(), guildId, roleId: "mod-role", capability: "moderation" },
    });
    await db.dashboardGrant.create({
      data: { id: randomUUID(), guildId, kind: "role", subjectId: adminRoleId },
    });

    const member = await login(`${memberId}-code`);
    expect(member.status).toBe(403);
    expect(member.headers.get("set-cookie")).toBeNull();

    const moderator = await login(`${moderatorId}-code`);
    expect(moderator.status).toBe(403);
    expect(moderator.headers.get("set-cookie")).toBeNull();

    const memberStats = await fetch(`${baseUrl}/api/stats`);
    expect(memberStats.status).toBe(403);

    const owner = await login(`${ownerId}-code`);
    expect(owner.status).toBe(302);
    const ownerCookie = sessionCookie(owner);
    expect(owner.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    const stats = await fetch(`${baseUrl}/api/stats`, { headers: { cookie: ownerCookie } });
    expect(stats.status).toBe(200);
    expect(await stats.json()).toMatchObject({ module: "statistics", status: "ready", report: { marksIssued: "0.00", wallets: 0 } });

    const roleAdmin = await login("role-admin-code");
    const roleCookie = sessionCookie(roleAdmin);
    members.set("role-admin", { userId: "role-admin", roleIds: [] });
    const removed = await fetch(`${baseUrl}/api/stats`, { headers: { cookie: roleCookie } });
    expect(removed.status).toBe(403);
    const again = await fetch(`${baseUrl}/api/auth/status`, { headers: { cookie: roleCookie } });
    expect(again.status).toBe(403);
  });
});
