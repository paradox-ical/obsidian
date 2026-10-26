import { randomUUID } from "node:crypto";

import {
  decideCapability,
  decideDashboardAccess,
  OWNER_STAFF_ROLE,
  ownerActsAsStaff,
  evaluateSession,
  hashesEqual,
  isCapability,
  isModuleKey,
  moduleAvailable,
  PROTECTED_MODULES,
  randomToken,
  sha256,
  type Capability,
  type ModuleKey,
} from "@collective/domain";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";

export type Writer = PrismaClient | Prisma.TransactionClient;

export class PlatformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformError";
  }
}

function requireReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) {
    throw new PlatformError("A reason is required.");
  }
  return trimmed;
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function ensureGuild(
  db: Writer,
  input: { guildId: string; ownerUserId?: string | null; timezone?: string },
) {
  return db.guild.upsert({
    where: { guildId: input.guildId },
    create: {
      guildId: input.guildId,
      ownerUserId: input.ownerUserId ?? null,
      timezone: input.timezone ?? "Australia/Perth",
      updatedAt: new Date(),
    },
    update: input.ownerUserId === undefined ? {} : { ownerUserId: input.ownerUserId },
  });
}

export async function writeAudit(
  db: Writer,
  input: {
    guildId: string;
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    reason: string;
  },
) {
  return db.auditRecord.create({
    data: {
      id: randomUUID(),
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: requireReason(input.reason),
    },
  });
}

export async function saveDraft(
  db: Writer,
  input: { guildId: string; document: Prisma.InputJsonValue; actorUserId: string; reason: string },
) {
  const latest = await db.configVersion.findFirst({
    where: { guildId: input.guildId },
    orderBy: { version: "desc" },
  });
  const row = await db.configVersion.create({
    data: {
      id: randomUUID(),
      guildId: input.guildId,
      version: (latest?.version ?? 0) + 1,
      state: "draft",
      document: input.document,
    },
  });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "config.draft",
    targetType: "config_version",
    targetId: row.id,
    reason: input.reason,
  });
  return row;
}

export async function publishDraft(
  db: Writer,
  input: { guildId: string; draftId: string; actorUserId: string; reason: string },
) {
  const draft = await db.configVersion.findFirst({
    where: { id: input.draftId, guildId: input.guildId, state: "draft" },
  });
  if (!draft) {
    throw new PlatformError("Draft not found.");
  }
  const published = await db.configVersion.update({
    where: { id: draft.id },
    data: { state: "published", publishedAt: new Date() },
  });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "config.publish",
    targetType: "config_version",
    targetId: published.id,
    reason: input.reason,
  });
  return published;
}

export function activeConfig(db: Writer, guildId: string) {
  return db.configVersion.findFirst({
    where: { guildId, state: "published" },
    orderBy: { version: "desc" },
  });
}

export async function setMaintenance(
  db: Writer,
  input: { guildId: string; moduleKey: string; maintenance: boolean; actorUserId: string; reason: string },
) {
  if (!isModuleKey(input.moduleKey)) {
    throw new PlatformError("Unknown module.");
  }
  if (input.maintenance && (PROTECTED_MODULES as readonly string[]).includes(input.moduleKey)) {
    throw new PlatformError("Verification and moderation stay available during maintenance.");
  }
  const row = await db.featureFlag.upsert({
    where: { guildId_moduleKey: { guildId: input.guildId, moduleKey: input.moduleKey } },
    create: {
      id: randomUUID(),
      guildId: input.guildId,
      moduleKey: input.moduleKey,
      maintenance: input.maintenance,
      updatedAt: new Date(),
    },
    update: { maintenance: input.maintenance },
  });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "feature.maintenance",
    targetType: "feature_flag",
    targetId: row.id,
    reason: input.reason,
  });
  return row;
}

export async function openModulesForTesting(db: Writer): Promise<number> {
  if (!ownerActsAsStaff()) {
    return 0;
  }
  const cleared = await db.featureFlag.updateMany({ where: { maintenance: true }, data: { maintenance: false } });
  return cleared.count;
}

export async function moduleIsAvailable(db: Writer, guildId: string, moduleKey: ModuleKey): Promise<boolean> {
  const row = await db.featureFlag.findUnique({
    where: { guildId_moduleKey: { guildId, moduleKey } },
  });
  return moduleAvailable(moduleKey, row?.maintenance ?? false);
}

export async function grantCapability(
  db: Writer,
  input: { guildId: string; roleId: string; capability: string; actorUserId: string; reason: string },
) {
  if (!isCapability(input.capability)) {
    throw new PlatformError("Unknown capability.");
  }
  const row = await db.capabilityGrant.upsert({
    where: {
      guildId_roleId_capability: {
        guildId: input.guildId,
        roleId: input.roleId,
        capability: input.capability,
      },
    },
    create: {
      id: randomUUID(),
      guildId: input.guildId,
      roleId: input.roleId,
      capability: input.capability,
    },
    update: {},
  });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "capability.grant",
    targetType: "capability_grant",
    targetId: row.id,
    reason: input.reason,
  });
  return row;
}

export async function grantDashboardAccess(
  db: Writer,
  input: { guildId: string; kind: "user" | "role"; subjectId: string; actorUserId: string; reason: string },
) {
  const row = await db.dashboardGrant.upsert({
    where: {
      guildId_kind_subjectId: {
        guildId: input.guildId,
        kind: input.kind,
        subjectId: input.subjectId,
      },
    },
    create: {
      id: randomUUID(),
      guildId: input.guildId,
      kind: input.kind,
      subjectId: input.subjectId,
    },
    update: {},
  });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "dashboard.grant",
    targetType: "dashboard_grant",
    targetId: row.id,
    reason: input.reason,
  });
  return row;
}

export async function dashboardDecision(
  db: Writer,
  input: { guildId: string; userId: string; roleIds: readonly string[] },
) {
  const guild = await db.guild.findUnique({ where: { guildId: input.guildId } });
  const grants = await db.dashboardGrant.findMany({ where: { guildId: input.guildId } });
  return decideDashboardAccess({
    userId: input.userId,
    roleIds: input.roleIds,
    ownerUserId: guild?.ownerUserId ?? null,
    userGrantIds: grants.filter((grant) => grant.kind === "user").map((grant) => grant.subjectId),
    roleGrantIds: grants.filter((grant) => grant.kind === "role").map((grant) => grant.subjectId),
  });
}

export async function actorCan(
  db: Writer,
  input: { guildId: string; roleIds: readonly string[]; capability: Capability },
) {
  if (input.roleIds.includes(OWNER_STAFF_ROLE) && ownerActsAsStaff()) {
    return "allowed";
  }
  const grants = await db.capabilityGrant.findMany({ where: { guildId: input.guildId } });
  return decideCapability({
    roleIds: input.roleIds,
    grants: grants.map((grant) => ({ roleId: grant.roleId, capability: grant.capability })),
    capability: input.capability,
  });
}

export async function enqueueJob(
  db: Writer,
  input: {
    guildId?: string | null;
    jobType: string;
    payload: Prisma.InputJsonValue;
    idempotencyKey: string;
    maxAttempts?: number;
    runAt?: Date;
  },
) {
  const existing = await db.job.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    return { job: existing, created: false as const };
  }
  try {
    const job = await db.job.create({
      data: {
        id: randomUUID(),
        guildId: input.guildId ?? null,
        jobType: input.jobType,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey,
        status: "pending",
        runAt: input.runAt ?? new Date(),
        maxAttempts: input.maxAttempts ?? 5,
        updatedAt: new Date(),
      },
    });
    return { job, created: true as const };
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    const job = await db.job.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (!job) {
      throw error;
    }
    return { job, created: false as const };
  }
}

export async function enqueueOutbox(
  db: Writer,
  input: {
    guildId?: string | null;
    eventType: string;
    payload: Prisma.InputJsonValue;
    idempotencyKey: string;
    maxAttempts?: number;
    availableAt?: Date;
  },
) {
  const existing = await db.outboxMessage.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    return { message: existing, created: false as const };
  }
  try {
    const message = await db.outboxMessage.create({
      data: {
        id: randomUUID(),
        guildId: input.guildId ?? null,
        eventType: input.eventType,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey,
        status: "pending",
        availableAt: input.availableAt ?? new Date(),
        maxAttempts: input.maxAttempts ?? 5,
      },
    });
    return { message, created: true as const };
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    const message = await db.outboxMessage.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (!message) {
      throw error;
    }
    return { message, created: false as const };
  }
}

export interface ClaimedWork {
  id: string;
  guildId: string | null;
  type: string;
  payload: unknown;
  idempotencyKey: string;
  attempts: number;
  maxAttempts: number;
}

export async function claimJob(db: PrismaClient, owner: string, now: Date, leaseMs: number): Promise<ClaimedWork | null> {
  const leaseUntil = new Date(now.getTime() + leaseMs);
  const rows = await db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    WITH candidate AS (
      SELECT id FROM "job"
      WHERE ("status" = 'pending' AND "runAt" <= ${now})
         OR ("status" = 'leased' AND "leaseUntil" IS NOT NULL AND "leaseUntil" < ${now})
      ORDER BY "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "job" AS work
    SET "status" = 'leased',
        "leaseOwner" = ${owner},
        "leaseUntil" = ${leaseUntil},
        "attempts" = work."attempts" + 1,
        "updatedAt" = ${now}
    FROM candidate
    WHERE work.id = candidate.id
    RETURNING work.id AS id,
              work."guildId" AS guild_id,
              work."jobType" AS type,
              work.payload AS payload,
              work."idempotencyKey" AS idempotency_key,
              work.attempts AS attempts,
              work."maxAttempts" AS max_attempts
  `);
  return mapClaim(rows[0]);
}

export async function claimOutbox(
  db: PrismaClient,
  owner: string,
  now: Date,
  leaseMs: number,
): Promise<ClaimedWork | null> {
  const leaseUntil = new Date(now.getTime() + leaseMs);
  const rows = await db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    WITH candidate AS (
      SELECT id FROM "outbox_message"
      WHERE ("status" = 'pending' AND "availableAt" <= ${now})
         OR ("status" = 'leased' AND "leaseUntil" IS NOT NULL AND "leaseUntil" < ${now})
      ORDER BY "availableAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "outbox_message" AS work
    SET "status" = 'leased',
        "leaseOwner" = ${owner},
        "leaseUntil" = ${leaseUntil},
        "attempts" = work."attempts" + 1
    FROM candidate
    WHERE work.id = candidate.id
    RETURNING work.id AS id,
              work."guildId" AS guild_id,
              work."eventType" AS type,
              work.payload AS payload,
              work."idempotencyKey" AS idempotency_key,
              work.attempts AS attempts,
              work."maxAttempts" AS max_attempts
  `);
  return mapClaim(rows[0]);
}

function mapClaim(row: Record<string, unknown> | undefined): ClaimedWork | null {
  if (!row) {
    return null;
  }
  const guildId = row["guild_id"];
  return {
    id: String(row["id"]),
    guildId: guildId === null || guildId === undefined ? null : String(guildId),
    type: String(row["type"]),
    payload: row["payload"],
    idempotencyKey: String(row["idempotency_key"]),
    attempts: Number(row["attempts"]),
    maxAttempts: Number(row["max_attempts"]),
  };
}

export async function finishJob(
  db: PrismaClient,
  claimed: ClaimedWork,
  outcome: { ok: true } | { ok: false; error: string; retryAt: Date | null },
) {
  if (outcome.ok) {
    await db.job.update({
      where: { id: claimed.id },
      data: { status: "succeeded", leaseOwner: null, leaseUntil: null, lastError: null },
    });
    return "succeeded" as const;
  }
  const dead = outcome.retryAt === null || claimed.attempts >= claimed.maxAttempts;
  await db.job.update({
    where: { id: claimed.id },
    data: {
      status: dead ? "dead" : "pending",
      leaseOwner: null,
      leaseUntil: null,
      lastError: outcome.error.slice(0, 500),
      ...(dead ? {} : { runAt: outcome.retryAt ?? undefined }),
    },
  });
  return dead ? ("dead" as const) : ("retry" as const);
}

export async function finishOutbox(
  db: PrismaClient,
  claimed: ClaimedWork,
  outcome: { ok: true; deliveredAt: Date } | { ok: false; error: string; retryAt: Date | null },
) {
  if (outcome.ok) {
    await db.outboxMessage.update({
      where: { id: claimed.id },
      data: {
        status: "delivered",
        deliveredAt: outcome.deliveredAt,
        leaseOwner: null,
        leaseUntil: null,
        lastError: null,
      },
    });
    return "delivered" as const;
  }
  const dead = outcome.retryAt === null || claimed.attempts >= claimed.maxAttempts;
  await db.outboxMessage.update({
    where: { id: claimed.id },
    data: {
      status: dead ? "dead" : "pending",
      leaseOwner: null,
      leaseUntil: null,
      lastError: outcome.error.slice(0, 500),
      ...(dead ? {} : { availableAt: outcome.retryAt ?? undefined }),
    },
  });
  return dead ? ("dead" as const) : ("retry" as const);
}

export function listDeadJobs(db: Writer, guildId?: string) {
  return db.job.findMany({
    where: { status: "dead", ...(guildId ? { guildId } : {}) },
    select: { id: true, guildId: true, jobType: true, attempts: true, lastError: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function openSession(
  db: Writer,
  input: {
    guildId: string;
    actorUserId: string;
    purpose: string;
    payload: Prisma.InputJsonValue;
    expiresAt: Date;
    requiredCapability?: Capability | null;
  },
) {
  const published = await activeConfig(db, input.guildId);
  return db.interactionSession.create({
    data: {
      id: randomUUID(),
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      revision: published?.version ?? 0,
      requiredCapability: input.requiredCapability ?? null,
      purpose: input.purpose,
      payload: input.payload,
      expiresAt: input.expiresAt,
    },
  });
}

export async function executeSession(
  db: Writer,
  input: { sessionId: string; actorUserId: string; roleIds: readonly string[]; now: Date },
) {
  const session = await db.interactionSession.findUnique({ where: { id: input.sessionId } });
  if (!session) {
    return { ok: false as const, reason: "missing" as const };
  }
  const published = await activeConfig(db, session.guildId);
  const gate = evaluateSession(
    {
      actorUserId: session.actorUserId,
      revision: session.revision,
      expiresAt: session.expiresAt,
      consumedAt: session.consumedAt,
    },
    input.actorUserId,
    published?.version ?? 0,
    input.now,
  );
  if (gate !== "ok") {
    return { ok: false as const, reason: gate };
  }
  if (session.requiredCapability) {
    if (!isCapability(session.requiredCapability)) {
      return { ok: false as const, reason: "denied" as const };
    }
    const decision = await actorCan(db, {
      guildId: session.guildId,
      roleIds: input.roleIds,
      capability: session.requiredCapability,
    });
    if (decision === "denied") {
      return { ok: false as const, reason: "denied" as const };
    }
  }
  const claimed = await db.interactionSession.updateMany({
    where: { id: session.id, consumedAt: null },
    data: { consumedAt: input.now },
  });
  if (claimed.count !== 1) {
    return { ok: false as const, reason: "consumed" as const };
  }
  return { ok: true as const, session };
}

export async function createOauthState(db: Writer, now: Date) {
  const state = randomToken();
  await db.oauthState.create({
    data: {
      id: randomUUID(),
      stateHash: sha256(state),
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
    },
  });
  return state;
}

export async function consumeOauthState(db: Writer, state: string, now: Date): Promise<boolean> {
  const row = await db.oauthState.findUnique({ where: { stateHash: sha256(state) } });
  if (!row || row.consumedAt || row.expiresAt.getTime() <= now.getTime()) {
    return false;
  }
  const updated = await db.oauthState.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: now },
  });
  return updated.count === 1;
}

export async function createAdminSession(
  db: Writer,
  input: { userId: string; guildId: string; expiresAt: Date },
) {
  const token = randomToken();
  const csrfToken = randomToken();
  await db.adminSession.create({
    data: {
      id: randomUUID(),
      tokenHash: sha256(token),
      csrfToken,
      userId: input.userId,
      guildId: input.guildId,
      expiresAt: input.expiresAt,
    },
  });
  return { token, csrfToken };
}

export async function readAdminSession(db: Writer, token: string, now: Date) {
  const tokenHash = sha256(token);
  const row = await db.adminSession.findUnique({ where: { tokenHash } });
  if (!row || row.revokedAt || row.expiresAt.getTime() <= now.getTime()) {
    return null;
  }
  if (!hashesEqual(row.tokenHash, tokenHash)) {
    return null;
  }
  return row;
}

export async function revokeAdminSession(db: Writer, token: string, now: Date) {
  const row = await readAdminSession(db, token, now);
  if (!row) {
    return false;
  }
  await db.adminSession.update({ where: { id: row.id }, data: { revokedAt: now } });
  return true;
}

export async function readStatistics(
  db: Writer,
  input: { guildId: string; roleIds: readonly string[] },
) {
  const decision = await actorCan(db, {
    guildId: input.guildId,
    roleIds: input.roleIds,
    capability: "statistics",
  });
  if (decision !== "allowed") {
    return { status: "denied" as const };
  }
  const { economyReport } = await import("./ledger.js");
  return { status: "ready" as const, module: "statistics" as const, report: await economyReport(db, input.guildId) };
}

export async function routeInteraction(
  db: Writer,
  input: { customId: string; actorUserId: string; roleIds: readonly string[]; now: Date },
) {
  if (!input.customId.startsWith("session:")) {
    return { handled: false as const };
  }
  const result = await executeSession(db, {
    sessionId: input.customId.slice("session:".length),
    actorUserId: input.actorUserId,
    roleIds: input.roleIds,
    now: input.now,
  });
  if (!result.ok) {
    return { handled: true as const, access: "denied" as const, reason: result.reason };
  }
  if (result.session.purpose === "stats") {
    const { economyReport } = await import("./ledger.js");
    return {
      handled: true as const,
      access: "allowed" as const,
      body: { module: "statistics" as const, status: "ready" as const, report: await economyReport(db, result.session.guildId) },
    };
  }
  return { handled: true as const, access: "allowed" as const, purpose: result.session.purpose };
}

export async function registerAuthAttempt(db: Writer, subjectHash: string, now: Date, limit = 10) {
  const windowStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes()),
  );
  const existing = await db.authAttempt.findUnique({
    where: { subjectHash_windowStart: { subjectHash, windowStart } },
  });
  if (!existing) {
    try {
      await db.authAttempt.create({
        data: { id: randomUUID(), subjectHash, windowStart, count: 1 },
      });
      return { allowed: true as const };
    } catch (error) {
      if (!isUnique(error)) {
        throw error;
      }
    }
  }
  const current =
    existing ??
    (await db.authAttempt.findUnique({
      where: { subjectHash_windowStart: { subjectHash, windowStart } },
    }));
  if (!current) {
    throw new PlatformError("Auth attempt window was not recorded.");
  }
  const updated = await db.authAttempt.updateMany({
    where: { id: current.id, count: { lt: limit } },
    data: { count: { increment: 1 } },
  });
  return { allowed: updated.count === 1 };
}
