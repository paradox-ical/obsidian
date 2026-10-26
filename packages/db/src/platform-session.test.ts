import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { executeSession } from "./platform.js";

describe("session confirmation concurrency", () => {
  it("allows one concurrent consumer and leaves stale and wrong-actor controls unconsumed", async () => {
    const now = new Date();
    const row = { id: "session", guildId: "guild", actorUserId: "actor", revision: 1, purpose: "discord.experience", payload: {}, requiredCapability: null, consumedAt: null as Date | null, expiresAt: new Date(now.getTime() + 60000) };
    // A controlled repository double exercises executeSession itself, including
    // the compare-and-set predicate. This is not a PostgreSQL integration test.
    const updateMany = vi.fn(async ({ where, data }) => {
      if (row.consumedAt !== where.consumedAt) return { count: 0 };
      row.consumedAt = data.consumedAt;
      return { count: 1 };
    });
    const db = { interactionSession: { findUnique: async () => ({ ...row }), updateMany }, configVersion: { findFirst: async () => ({ version: 1 }) } } as unknown as PrismaClient;
    expect(await executeSession(db, { sessionId: row.id, actorUserId: "other", roleIds: [], now })).toEqual({ ok: false, reason: "actor" });
    expect(updateMany).not.toHaveBeenCalled();
    const results = await Promise.all([executeSession(db, { sessionId: row.id, actorUserId: "actor", roleIds: [], now }), executeSession(db, { sessionId: row.id, actorUserId: "actor", roleIds: [], now })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: "consumed" }]);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: row.id, consumedAt: null }, data: { consumedAt: now } });
  });
});
