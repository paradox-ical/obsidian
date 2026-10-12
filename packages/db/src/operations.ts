import type { Prisma } from "../generated/prisma/client.js";

import {
  maintenanceDecision,
  moduleMaintenanceView,
  operationsSimulations,
  previewOperationsDocument,
  redactOperationsDocument,
  redactText,
  validateOperationsDocument,
  type OperationsDocument,
} from "@collective/domain";

import { ensureGuild, listDeadJobs, publishDraft, saveDraft, setMaintenance, writeAudit, type Writer } from "./platform.js";
import { readModerationPolicy } from "./moderation.js";
import { readTicketSettings } from "./tickets.js";

const ROOM_EMPTY_MS = 6 * 60 * 60 * 1000;

export async function readOperations(db: Writer, guildId: string, now: Date) {
  const [flags, versions, active, jobs, outbox, audits, negativeWallets, duplicateRewards, stalledMatches, overdueRooms, market, tickets, moderation] = await Promise.all([
    db.featureFlag.findMany({ where: { guildId }, select: { moduleKey: true, maintenance: true } }),
    db.configVersion.findMany({
      where: { guildId },
      orderBy: { version: "desc" },
      take: 20,
      select: { id: true, version: true, state: true, publishedAt: true, createdAt: true },
    }),
    db.configVersion.findFirst({ where: { guildId, state: "published" }, orderBy: { version: "desc" }, select: { id: true, version: true } }),
    listDeadJobs(db, guildId),
    db.outboxMessage.findMany({
      where: { guildId, status: "dead" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, eventType: true, attempts: true, lastError: true, createdAt: true },
    }),
    db.auditRecord.findMany({
      where: { guildId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, action: true, targetType: true, targetId: true, reason: true, createdAt: true },
    }),
    db.wallet.count({ where: { guildId, OR: [{ availableMinor: { lt: 0 } }, { escrowMinor: { lt: 0 } }] } }),
    duplicateRewardCount(db, guildId),
    db.pvpMatch.count({ where: { guildId, status: "active", turnDeadline: { lt: now } } }),
    db.tempRoom.count({ where: { guildId, status: "open", emptySince: { lt: new Date(now.getTime() - ROOM_EMPTY_MS) } } }),
    db.ingotMarket.findUnique({ where: { guildId }, select: { backingMinor: true, protectedReserve: true, inventory: true, paused: true } }),
    readTicketSettings(db, guildId),
    readModerationPolicy(db, guildId),
  ]);
  const alerts = [
    ...(jobs.length > 0 ? ["dead_jobs"] : []),
    ...(outbox.length > 0 ? ["discord_delivery_failures"] : []),
    ...(negativeWallets > 0 ? ["negative_wallets"] : []),
    ...(duplicateRewards > 0 ? ["duplicate_rewards"] : []),
    ...(stalledMatches > 0 ? ["stalled_matches"] : []),
    ...(overdueRooms > 0 ? ["overdue_rooms"] : []),
    ...(market && market.backingMinor < 0n ? ["negative_backing"] : []),
  ];
  return {
    access: "allowed" as const,
    draftsAreActive: false as const,
    modules: moduleMaintenanceView(flags),
    versions: versions.map((version) => ({ ...version, active: version.id === active?.id })),
    activeVersion: active?.version ?? null,
    jobs: jobs.map((job) => ({ ...job, lastError: job.lastError ? redactText(job.lastError) : null })),
    outbox: outbox.map((message) => ({ ...message, lastError: message.lastError ? redactText(message.lastError) : null })),
    audits: audits.map((audit) => ({ ...audit, reason: redactText(audit.reason) })),
    health: {
      deadJobs: jobs.length,
      discordDeliveryFailures: outbox.length,
      negativeWallets,
      duplicateRewards,
      stalledMatches,
      overdueRooms,
      backing: market ? market.backingMinor.toString() : "not_opened",
      protectedReserve: market ? market.protectedReserve.toString() : "not_opened",
      inventory: market ? market.inventory.toString() : "not_opened",
      marketPaused: market?.paused ?? false,
      ticketRetentionDays: tickets.settings.retentionDays,
      warningRetentionDays: moderation.policy.retentionDays,
      alerts,
    },
    simulations: operationsSimulations(),
  };
}

export async function exportOperationsConfig(db: Writer, guildId: string) {
  const active = await db.configVersion.findFirst({
    where: { guildId, state: "published" },
    orderBy: { version: "desc" },
  });
  if (!active) {
    return { stored: false as const, state: "none" as const, secrets: "omitted" as const };
  }
  return {
    stored: true as const,
    state: "published" as const,
    version: active.version,
    secrets: "omitted" as const,
    document: redactOperationsDocument(active.document as OperationsDocument),
  };
}

export function previewOperationsImport(document: unknown) {
  return previewOperationsDocument(document);
}

export async function importOperationsDraft(
  db: Writer,
  input: { guildId: string; document: unknown; actorUserId: string; reason: string },
) {
  const validated = validateOperationsDocument(input.document);
  if (!validated.ok) {
    return { result: "invalid" as const, errors: validated.errors };
  }
  if (!input.reason.trim()) {
    return { result: "invalid" as const, errors: ["A reason is required."] };
  }
  await ensureGuild(db, { guildId: input.guildId });
  const draft = await saveDraft(db, {
    guildId: input.guildId,
    document: validated.document as Prisma.InputJsonValue,
    actorUserId: input.actorUserId,
    reason: input.reason,
  });
  return { result: "draft" as const, draftId: draft.id, version: draft.version, state: "draft" as const, active: false as const };
}

export async function publishOperationsDraft(
  db: Writer,
  input: { guildId: string; draftId: string; actorUserId: string; reason: string },
) {
  if (!input.reason.trim()) {
    return { result: "invalid" as const };
  }
  const draft = await db.configVersion.findFirst({ where: { id: input.draftId, guildId: input.guildId, state: "draft" } });
  if (!draft) {
    return { result: "not_found" as const };
  }
  const published = await publishDraft(db, input);
  return { result: "published" as const, version: published.version, state: "published" as const, active: true as const };
}

export async function rollbackOperationsConfig(
  db: Writer,
  input: { guildId: string; version: number; actorUserId: string; reason: string; confirm: boolean },
) {
  if (!input.reason.trim() || !Number.isInteger(input.version)) {
    return { result: "invalid" as const };
  }
  const source = await db.configVersion.findFirst({ where: { guildId: input.guildId, version: input.version } });
  if (!source) {
    return { result: "not_found" as const };
  }
  const validated = validateOperationsDocument(source.document);
  if (!validated.ok) {
    return { result: "invalid" as const, errors: validated.errors };
  }
  await ensureGuild(db, { guildId: input.guildId });
  const draft = await saveDraft(db, {
    guildId: input.guildId,
    document: validated.document as Prisma.InputJsonValue,
    actorUserId: input.actorUserId,
    reason: input.reason,
  });
  if (!input.confirm) {
    return { result: "draft" as const, draftId: draft.id, version: draft.version, state: "draft" as const, active: false as const };
  }
  const published = await publishDraft(db, { guildId: input.guildId, draftId: draft.id, actorUserId: input.actorUserId, reason: input.reason });
  return { result: "published" as const, version: published.version, state: "published" as const, active: true as const, replacedVersion: source.version };
}

export async function changeOperationsMaintenance(
  db: Writer,
  input: { guildId: string; moduleKey: string; maintenance: boolean; actorUserId: string; reason: string },
) {
  const decision = maintenanceDecision(input.moduleKey, input.maintenance);
  if (decision === "invalid" || !input.reason.trim()) {
    return { result: "invalid" as const };
  }
  if (decision === "protected") {
    return { result: "protected" as const, available: true as const };
  }
  await ensureGuild(db, { guildId: input.guildId });
  const row = await setMaintenance(db, {
    guildId: input.guildId,
    moduleKey: input.moduleKey,
    maintenance: input.maintenance,
    actorUserId: input.actorUserId,
    reason: input.reason,
  });
  return { result: "saved" as const, moduleKey: row.moduleKey, maintenance: row.maintenance };
}

export async function recordOperationsAlert(
  db: Writer,
  input: { guildId: string; actorUserId: string; reason: string; now: Date },
) {
  if (!input.reason.trim()) {
    return { result: "invalid" as const };
  }
  const view = await readOperations(db, input.guildId, input.now);
  if (view.health.alerts.length === 0) {
    return { result: "clear" as const };
  }
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "operations.alert",
    targetType: "guild",
    targetId: input.guildId,
    reason: `${input.reason.trim()} Alerts: ${view.health.alerts.join(", ")}.`,
  });
  return { result: "recorded" as const, alerts: view.health.alerts, posted: "not_posted" as const };
}

async function duplicateRewardCount(db: Writer, guildId: string): Promise<number> {
  const rows = await db.$queryRaw<Array<{ duplicates: bigint }>>`
    SELECT COUNT(*) AS duplicates FROM (
      SELECT "idempotencyKey" FROM "reward_event"
      WHERE "guildId" = ${guildId}
      GROUP BY "idempotencyKey"
      HAVING COUNT(*) > 1
    ) AS duplicated
  `;
  return Number(rows[0]?.duplicates ?? 0);
}
