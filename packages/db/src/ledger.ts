import { randomUUID } from "node:crypto";

import {
  emptyPublicWallet,
  exampleEconomySettings,
  formatMinor,
  marksHoldDecision,
  marksToMinor,
  marksTransferDecision,
  perthPeriod,
  prepareEconomySettings,
  presentPublicWallet,
  routineMonthlyMarks,
  type EconomySettingsInput,
} from "@collective/domain";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

import { actorCan, ensureGuild, moduleIsAvailable, writeAudit, type Writer } from "./platform.js";

type Tx = Prisma.TransactionClient;
type Root = PrismaClient;

const CURRENCY = "marks";

interface BudgetRow {
  guildId: string;
  scope: string;
  periodKey: string;
  subjectId: string;
  authorizedMinor: bigint;
  spentMinor: bigint;
}

interface WalletRow {
  availableMinor: bigint;
  escrowMinor: bigint;
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function asSettings(value: unknown): EconomySettingsInput | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const settings = value as EconomySettingsInput;
  if (typeof settings.transferMaxMarks !== "number" || typeof settings.guildRoutineMarks !== "number") {
    return null;
  }
  return settings;
}

async function settingsOf(db: Writer, guildId: string) {
  await ensureGuild(db, { guildId });
  const row = await db.economySettings.findUnique({ where: { guildId } });
  if (!row) {
    const settings = exampleEconomySettings();
    await db.economySettings.create({ data: { guildId, version: 1, label: settings.label, document: json(settings) } });
    return settings;
  }
  const settings = asSettings(row.document);
  if (!settings) {
    throw new Error("Stored economy settings are unreadable.");
  }
  return prepareEconomySettings(settings);
}

export async function readEconomySettings(db: Writer, guildId: string) {
  const stored = await db.economySettings.findUnique({ where: { guildId } });
  if (!stored) {
    return { stored: false as const, version: 0, settings: exampleEconomySettings(), simulation: routineMonthlyMarks() };
  }
  const settings = asSettings(stored.document);
  if (!settings) {
    throw new Error("Stored economy settings are unreadable.");
  }
  return { stored: true as const, version: stored.version, settings: prepareEconomySettings(settings), simulation: routineMonthlyMarks() };
}

export async function saveEconomySettings(
  db: Writer,
  input: { guildId: string; settings: EconomySettingsInput; actorUserId: string; reason: string },
) {
  await ensureGuild(db, { guildId: input.guildId });
  const settings = prepareEconomySettings(input.settings);
  const current = await db.economySettings.findUnique({ where: { guildId: input.guildId } });
  const version = (current?.version ?? 0) + 1;
  await db.economySettings.upsert({
    where: { guildId: input.guildId },
    create: { guildId: input.guildId, version, label: settings.label, document: json(settings) },
    update: { version, label: settings.label, document: json(settings) },
  });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "economy.settings",
    targetType: "economy_settings",
    targetId: input.guildId,
    reason: input.reason,
  });
  return { version, settings, simulation: routineMonthlyMarks() };
}

async function lockWallet(tx: Tx, guildId: string, userId: string, currency = CURRENCY): Promise<WalletRow> {
  await tx.$executeRaw`
    INSERT INTO "wallet" ("guildId", "userId", "currency", "availableMinor", "escrowMinor", "updatedAt")
    VALUES (${guildId}, ${userId}, ${currency}, 0, 0, NOW())
    ON CONFLICT ("guildId", "userId", "currency") DO NOTHING
  `;
  const rows = await tx.$queryRaw<WalletRow[]>`
    SELECT "availableMinor", "escrowMinor" FROM "wallet"
    WHERE "guildId" = ${guildId} AND "userId" = ${userId} AND "currency" = ${currency}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) {
    throw new Error("Wallet lock did not return a row.");
  }
  return row;
}

async function lockBudget(tx: Tx, guildId: string, scope: string, periodKey: string, subjectId: string, authorized: bigint): Promise<BudgetRow> {
  await tx.$executeRaw`
    INSERT INTO "issuance_budget" ("guildId", "scope", "periodKey", "subjectId", "authorizedMinor", "spentMinor", "updatedAt")
    VALUES (${guildId}, ${scope}, ${periodKey}, ${subjectId}, ${authorized}, 0, NOW())
    ON CONFLICT ("guildId", "scope", "periodKey", "subjectId") DO NOTHING
  `;
  const rows = await tx.$queryRaw<BudgetRow[]>`
    SELECT "guildId", "scope", "periodKey", "subjectId", "authorizedMinor", "spentMinor"
    FROM "issuance_budget"
    WHERE "guildId" = ${guildId} AND "scope" = ${scope} AND "periodKey" = ${periodKey} AND "subjectId" = ${subjectId}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) {
    throw new Error("Budget lock did not return a row.");
  }
  return row;
}

async function lockExistingBudget(tx: Tx, guildId: string, scope: string, periodKey: string, subjectId: string): Promise<BudgetRow | null> {
  const rows = await tx.$queryRaw<BudgetRow[]>`
    SELECT "guildId", "scope", "periodKey", "subjectId", "authorizedMinor", "spentMinor"
    FROM "issuance_budget"
    WHERE "guildId" = ${guildId} AND "scope" = ${scope} AND "periodKey" = ${periodKey} AND "subjectId" = ${subjectId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function addSpent(tx: Tx, row: BudgetRow, delta: bigint) {
  await tx.$executeRaw`
    UPDATE "issuance_budget"
    SET "spentMinor" = "spentMinor" + ${delta}, "updatedAt" = NOW()
    WHERE "guildId" = ${row.guildId} AND "scope" = ${row.scope} AND "periodKey" = ${row.periodKey} AND "subjectId" = ${row.subjectId}
  `;
}

async function setAvailable(tx: Tx, guildId: string, userId: string, available: bigint, escrow: bigint, currency = CURRENCY) {
  if (available < 0n || escrow < 0n) {
    throw new Error("A wallet balance cannot become negative.");
  }
  await tx.$executeRaw`
    UPDATE "wallet"
    SET "availableMinor" = ${available}, "escrowMinor" = ${escrow}, "updatedAt" = NOW()
    WHERE "guildId" = ${guildId} AND "userId" = ${userId} AND "currency" = ${currency}
  `;
}

async function writeEntry(tx: Tx, input: {
  guildId: string;
  userId: string;
  currency?: string;
  direction: "credit" | "debit";
  kind: string;
  amountMinor: bigint;
  source: string;
  sourceId: string;
  pace: string;
  idempotencyKey: string;
  reversesEntryId?: string | null;
  reason: string;
  actorUserId: string;
  now: Date;
}) {
  return tx.ledgerEntry.create({
    data: {
      id: randomUUID(),
      guildId: input.guildId,
      userId: input.userId,
      currency: input.currency ?? CURRENCY,
      direction: input.direction,
      kind: input.kind,
      amountMinor: input.amountMinor,
      source: input.source,
      sourceId: input.sourceId,
      pace: input.pace,
      idempotencyKey: input.idempotencyKey,
      reversesEntryId: input.reversesEntryId ?? null,
      reason: input.reason,
      actorUserId: input.actorUserId,
      createdAt: input.now,
    },
  });
}

export async function moveHeldCurrency(tx: Tx, input: {
  guildId: string;
  userId: string;
  currency: string;
  availableDelta: bigint;
  escrowDelta: bigint;
  kind: string;
  direction: "credit" | "debit";
  amountMinor: bigint;
  source: string;
  sourceId: string;
  pace: string;
  idempotencyKey: string;
  reason: string;
  actorUserId: string;
  now: Date;
}): Promise<"ok" | "insufficient" | "already_recorded"> {
  const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    return "already_recorded";
  }
  const wallet = await lockWallet(tx, input.guildId, input.userId, input.currency);
  const available = wallet.availableMinor + input.availableDelta;
  const escrow = wallet.escrowMinor + input.escrowDelta;
  if (available < 0n || escrow < 0n) {
    return "insufficient";
  }
  await setAvailable(tx, input.guildId, input.userId, available, escrow, input.currency);
  await writeEntry(tx, input);
  return "ok";
}

export async function readMemberWallet(db: Writer, guildId: string, userId: string) {
  const marks = await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId, userId, currency: CURRENCY } } });
  const ingots = await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId, userId, currency: "ingots" } } });
  return presentPublicWallet({
    availableMinor: marks?.availableMinor ?? 0n,
    escrowMinor: marks?.escrowMinor ?? 0n,
    ingotsAvailable: ingots?.availableMinor ?? 0n,
    ingotsEscrow: ingots?.escrowMinor ?? 0n,
  });
}

export async function issueMarks(
  db: Root,
  input: {
    guildId: string;
    userId: string;
    amountMarks: number;
    source: string;
    sourceId: string;
    pace: "routine" | "exceptional";
    idempotencyKey: string;
    reason: string;
    actorUserId: string;
    now: Date;
  },
) {
  const amountMinor = marksToMinor(input.amountMarks);
  if (amountMinor === null || amountMinor <= 0n || input.userId === "treasury" || input.userId === "bot" || input.userId === "system") {
    return { result: "invalid" as const };
  }
  try {
    return await db.$transaction(async (tx) => postIssue(tx, { ...input, amountMinor }));
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    const existing = await db.ledgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    return { result: "already_recorded" as const, entryId: existing?.id ?? "", ledgerStatus: "posted" as const };
  }
}

async function postIssue(tx: Tx, input: {
  guildId: string;
  userId: string;
  amountMinor: bigint;
  source: string;
  sourceId: string;
  pace: "routine" | "exceptional";
  idempotencyKey: string;
  reason: string;
  actorUserId: string;
  now: Date;
}) {
  const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    return { result: "already_recorded" as const, entryId: existing.id, ledgerStatus: "posted" as const };
  }
  const settings = await settingsOf(tx, input.guildId);
  const period = perthPeriod(input.now);
  const routine = routineMonthlyMarks();
  const memberCap = marksToMinor(routine.routineMarks) ?? 0n;
  const guildCap = marksToMinor(settings.guildRoutineMarks) ?? 0n;
  if (input.pace === "routine") {
    const guildBudget = await lockBudget(tx, input.guildId, "guild_routine", period, "guild", guildCap);
    const memberBudget = await lockBudget(tx, input.guildId, "member_routine", period, input.userId, memberCap);
    if (memberBudget.spentMinor + input.amountMinor > memberBudget.authorizedMinor) {
      return { result: "capped" as const, scope: "member" as const };
    }
    if (guildBudget.spentMinor + input.amountMinor > guildBudget.authorizedMinor) {
      return { result: "capped" as const, scope: "guild" as const };
    }
    await addSpent(tx, memberBudget, input.amountMinor);
    await addSpent(tx, guildBudget, input.amountMinor);
  } else {
    const pool = await lockBudget(tx, input.guildId, "exceptional", period, "guild", 0n);
    if (pool.spentMinor + input.amountMinor > pool.authorizedMinor) {
      return { result: "unfunded" as const };
    }
    await addSpent(tx, pool, input.amountMinor);
  }
  const wallet = await lockWallet(tx, input.guildId, input.userId);
  await setAvailable(tx, input.guildId, input.userId, wallet.availableMinor + input.amountMinor, wallet.escrowMinor);
  const entry = await writeEntry(tx, {
    guildId: input.guildId,
    userId: input.userId,
    direction: "credit",
    kind: "issue",
    amountMinor: input.amountMinor,
    source: input.source,
    sourceId: input.sourceId,
    pace: input.pace,
    idempotencyKey: input.idempotencyKey,
    reason: input.reason,
    actorUserId: input.actorUserId,
    now: input.now,
  });
  return { result: "posted" as const, entryId: entry.id, ledgerStatus: "posted" as const };
}

export async function fundExceptional(
  db: Root,
  input: { guildId: string; amountMarks: number; idempotencyKey: string; reason: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "economy_operations" })) !== "allowed") {
    return { result: "denied" as const };
  }
  const amountMinor = marksToMinor(input.amountMarks);
  if (amountMinor === null || amountMinor <= 0n) {
    return { result: "invalid" as const };
  }
  return db.$transaction(async (tx) => {
    const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      return { result: "already_recorded" as const };
    }
    const pool = await lockBudget(tx, input.guildId, "exceptional", perthPeriod(input.now), "guild", 0n);
    await tx.$executeRaw`
      UPDATE "issuance_budget"
      SET "authorizedMinor" = "authorizedMinor" + ${amountMinor}, "updatedAt" = NOW()
      WHERE "guildId" = ${pool.guildId} AND "scope" = ${pool.scope} AND "periodKey" = ${pool.periodKey} AND "subjectId" = ${pool.subjectId}
    `;
    await writeEntry(tx, {
      guildId: input.guildId,
      userId: "system",
      direction: "credit",
      kind: "fund",
      amountMinor,
      source: "exceptional",
      sourceId: input.idempotencyKey,
      pace: "exceptional",
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      actorUserId: input.actorUserId,
      now: input.now,
    });
    await writeAudit(tx, {
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      action: "economy.fund",
      targetType: "issuance_budget",
      targetId: "exceptional",
      reason: input.reason,
    });
    return { result: "funded" as const, amount: formatMinor(amountMinor) };
  });
}

export async function reverseMarks(
  db: Root,
  input: { idempotencyKey: string; reason: string; actorUserId: string; now: Date },
) {
  const original = await db.ledgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (!original || original.kind === "reversal") {
    return { result: "missing" as const };
  }
  const reversalKey = `reversal:${original.id}`;
  const prior = await db.ledgerEntry.findUnique({ where: { idempotencyKey: reversalKey } });
  if (prior) {
    return { result: "already_reversed" as const, entryId: prior.id };
  }
  try {
    return await db.$transaction(async (tx) => {
      const again = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: reversalKey } });
      if (again) {
        return { result: "already_reversed" as const, entryId: again.id };
      }
      const current = await tx.ledgerEntry.findUnique({ where: { id: original.id } });
      if (!current) {
        return { result: "missing" as const };
      }
      const period = perthPeriod(current.createdAt);
      const memberBudget = current.kind === "issue"
        ? await lockExistingBudget(tx, current.guildId, current.pace === "exceptional" ? "exceptional" : "member_routine", period, current.pace === "exceptional" ? "guild" : current.userId)
        : null;
      const guildBudget = current.kind === "issue" && current.pace === "routine"
        ? await lockExistingBudget(tx, current.guildId, "guild_routine", period, "guild")
        : null;
      if (current.userId !== "system") {
        const wallet = await lockWallet(tx, current.guildId, current.userId);
        if (current.direction === "credit" && wallet.availableMinor < current.amountMinor) {
          return { result: "insufficient" as const };
        }
        const available = current.direction === "credit" ? wallet.availableMinor - current.amountMinor : wallet.availableMinor + current.amountMinor;
        await setAvailable(tx, current.guildId, current.userId, available, wallet.escrowMinor);
      }
      if (memberBudget) {
        await addSpent(tx, memberBudget, -current.amountMinor);
      }
      if (guildBudget) {
        await addSpent(tx, guildBudget, -current.amountMinor);
      }
      const entry = await writeEntry(tx, {
        guildId: current.guildId,
        userId: current.userId,
        direction: current.direction === "credit" ? "debit" : "credit",
        kind: "reversal",
        amountMinor: current.amountMinor,
        source: current.source,
        sourceId: current.sourceId,
        pace: current.pace,
        idempotencyKey: reversalKey,
        reversesEntryId: current.id,
        reason: input.reason,
        actorUserId: input.actorUserId,
        now: input.now,
      });
      return { result: "reversed" as const, entryId: entry.id };
    });
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    return { result: "already_reversed" as const, entryId: "" };
  }
}

export async function transferMarks(
  db: Root,
  input: { guildId: string; fromUserId: string; toUserId: string; amountMarks: number; idempotencyKey: string; now: Date },
) {
  if (!(await moduleIsAvailable(db, input.guildId, "economy"))) {
    return { result: "maintenance" as const };
  }
  const amountMinor = marksToMinor(input.amountMarks);
  if (amountMinor === null) {
    return { result: "invalid" as const };
  }
  const settings = await settingsOf(db, input.guildId);
  const maxMinor = marksToMinor(settings.transferMaxMarks) ?? 0n;
  const dailyMinor = marksToMinor(settings.transferDailyMarks) ?? 0n;
  const dayAgo = new Date(input.now.getTime() - 24 * 60 * 60 * 1000);
  const recent = await db.ledgerEntry.findFirst({
    where: {
      guildId: input.guildId,
      userId: input.fromUserId,
      kind: "transfer_out",
      createdAt: { gte: new Date(input.now.getTime() - settings.transferCooldownSeconds * 1000) },
    },
  });
  const sent = await db.ledgerEntry.findMany({
    where: { guildId: input.guildId, userId: input.fromUserId, kind: "transfer_out", createdAt: { gte: dayAgo } },
  });
  const sentToday = sent.reduce((sum, entry) => sum + entry.amountMinor, 0n);
  const wallet = await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId: input.guildId, userId: input.fromUserId, currency: CURRENCY } } });
  const decision = marksTransferDecision({
    fromUserId: input.fromUserId,
    toUserId: input.toUserId,
    amountMinor,
    availableMinor: wallet?.availableMinor ?? 0n,
    recentTransfer: Boolean(recent),
    sentTodayMinor: sentToday,
    maxMinor,
    dailyMinor,
  });
  if (decision !== "allowed") {
    return { result: decision };
  }
  const [first, second] = [input.fromUserId, input.toUserId].sort();
  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        return { result: "already_recorded" as const };
      }
      if (first === undefined || second === undefined) {
        return { result: "invalid" as const };
      }
      const lockedFirst = first === input.fromUserId ? await lockWallet(tx, input.guildId, first) : await lockWallet(tx, input.guildId, first);
      const lockedSecond = await lockWallet(tx, input.guildId, second);
      const from = input.fromUserId === first ? lockedFirst : lockedSecond;
      const to = input.toUserId === first ? lockedFirst : lockedSecond;
      if (from.availableMinor < amountMinor) {
        return { result: "insufficient" as const };
      }
      await setAvailable(tx, input.guildId, input.fromUserId, from.availableMinor - amountMinor, from.escrowMinor);
      await setAvailable(tx, input.guildId, input.toUserId, to.availableMinor + amountMinor, to.escrowMinor);
      await writeEntry(tx, {
        guildId: input.guildId,
        userId: input.fromUserId,
        direction: "debit",
        kind: "transfer_out",
        amountMinor,
        source: "transfer",
        sourceId: input.toUserId,
        pace: "transfer",
        idempotencyKey: input.idempotencyKey,
        reason: "Member transfer",
        actorUserId: input.fromUserId,
        now: input.now,
      });
      await writeEntry(tx, {
        guildId: input.guildId,
        userId: input.toUserId,
        direction: "credit",
        kind: "transfer_in",
        amountMinor,
        source: "transfer",
        sourceId: input.fromUserId,
        pace: "transfer",
        idempotencyKey: `${input.idempotencyKey}:credit`,
        reason: "Member transfer",
        actorUserId: input.fromUserId,
        now: input.now,
      });
      return { result: "transferred" as const, amount: formatMinor(amountMinor) };
    });
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    return { result: "already_recorded" as const };
  }
}

export async function holdMarks(
  db: Root,
  input: { guildId: string; userId: string; amountMarks: number; idempotencyKey: string; reason: string; now: Date },
) {
  const amountMinor = marksToMinor(input.amountMarks);
  if (amountMinor === null) {
    return { result: "invalid" as const };
  }
  try {
    return await db.$transaction(async (tx) => moveEscrow(tx, { ...input, amountMinor, kind: "hold" }));
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    return { result: "already_recorded" as const };
  }
}

export async function releaseMarks(
  db: Root,
  input: { guildId: string; userId: string; amountMarks: number; idempotencyKey: string; reason: string; now: Date },
) {
  const amountMinor = marksToMinor(input.amountMarks);
  if (amountMinor === null) {
    return { result: "invalid" as const };
  }
  try {
    return await db.$transaction(async (tx) => moveEscrow(tx, { ...input, amountMinor, kind: "release" }));
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    return { result: "already_recorded" as const };
  }
}

export async function commitMarks(
  db: Root,
  input: { guildId: string; userId: string; amountMarks: number; idempotencyKey: string; reason: string; now: Date },
) {
  const amountMinor = marksToMinor(input.amountMarks);
  if (amountMinor === null) {
    return { result: "invalid" as const };
  }
  try {
    return await db.$transaction(async (tx) => moveEscrow(tx, { ...input, amountMinor, kind: "commit" }));
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    return { result: "already_recorded" as const };
  }
}

async function moveEscrow(tx: Tx, input: {
  guildId: string;
  userId: string;
  amountMinor: bigint;
  idempotencyKey: string;
  reason: string;
  now: Date;
  kind: "hold" | "release" | "commit";
}) {
  const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    return { result: "already_recorded" as const };
  }
  const wallet = await lockWallet(tx, input.guildId, input.userId);
  if (input.kind === "hold") {
    const decision = marksHoldDecision(wallet.availableMinor, input.amountMinor);
    if (decision !== "allowed") {
      return { result: decision };
    }
    await setAvailable(tx, input.guildId, input.userId, wallet.availableMinor - input.amountMinor, wallet.escrowMinor + input.amountMinor);
  } else if (wallet.escrowMinor < input.amountMinor) {
    return { result: "insufficient" as const };
  } else if (input.kind === "release") {
    await setAvailable(tx, input.guildId, input.userId, wallet.availableMinor + input.amountMinor, wallet.escrowMinor - input.amountMinor);
  } else {
    await setAvailable(tx, input.guildId, input.userId, wallet.availableMinor, wallet.escrowMinor - input.amountMinor);
  }
  await writeEntry(tx, {
    guildId: input.guildId,
    userId: input.userId,
    direction: input.kind === "release" ? "credit" : "debit",
    kind: input.kind === "hold" ? "escrow_hold" : input.kind === "release" ? "escrow_release" : "escrow_commit",
    amountMinor: input.amountMinor,
    source: "escrow",
    sourceId: input.idempotencyKey,
    pace: "escrow",
    idempotencyKey: input.idempotencyKey,
    reason: input.reason,
    actorUserId: input.userId,
    now: input.now,
  });
  return { result: input.kind === "hold" ? "held" as const : input.kind === "release" ? "released" as const : "committed" as const };
}

export async function adjustMarks(
  db: Root,
  input: {
    guildId: string;
    userId: string;
    action: "add" | "remove" | "set";
    amountMarks: number;
    reason: string;
    actorUserId: string;
    actorRoleIds: readonly string[];
    idempotencyKey: string;
    now: Date;
  },
) {
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "economy_operations" })) !== "allowed") {
    return { result: "denied" as const };
  }
  if (!(await moduleIsAvailable(db, input.guildId, "economy"))) {
    return { result: "maintenance" as const };
  }
  const amountMinor = marksToMinor(input.amountMarks);
  if (amountMinor === null) {
    return { result: "invalid" as const };
  }
  if (input.action === "set") {
    const current = await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId: input.guildId, userId: input.userId, currency: CURRENCY } } });
    const currentMinor = current?.availableMinor ?? 0n;
    if (amountMinor > currentMinor) {
      const delta = Number((amountMinor - currentMinor) / 100n);
      return adjustMarks(db, { ...input, action: "add", amountMarks: delta, idempotencyKey: `${input.idempotencyKey}:raise` });
    }
  }
  if (input.action === "add") {
    const issued = await issueMarks(db, {
      guildId: input.guildId,
      userId: input.userId,
      amountMarks: input.amountMarks,
      source: "staff_adjustment",
      sourceId: input.idempotencyKey,
      pace: "routine",
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      actorUserId: input.actorUserId,
      now: input.now,
    });
    if (issued.result === "posted" || issued.result === "already_recorded") {
      await writeAudit(db, {
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: "economy.adjust",
        targetType: "wallet",
        targetId: input.userId,
        reason: input.reason,
      });
    }
    return issued;
  }
  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        return { result: "already_recorded" as const };
      }
      const wallet = await lockWallet(tx, input.guildId, input.userId);
      const next = input.action === "set" ? amountMinor : wallet.availableMinor - amountMinor;
      if (next < 0n) {
        return { result: "insufficient" as const };
      }
      const delta = next - wallet.availableMinor;
      await setAvailable(tx, input.guildId, input.userId, next, wallet.escrowMinor);
      if (delta !== 0n) {
        await writeEntry(tx, {
          guildId: input.guildId,
          userId: input.userId,
          direction: delta > 0n ? "credit" : "debit",
          kind: "adjust",
          amountMinor: delta > 0n ? delta : -delta,
          source: "staff_adjustment",
          sourceId: input.idempotencyKey,
          pace: "routine",
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
          actorUserId: input.actorUserId,
          now: input.now,
        });
      }
      await writeAudit(tx, {
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: "economy.adjust",
        targetType: "wallet",
        targetId: input.userId,
        reason: input.reason,
      });
      return { result: "adjusted" as const, available: formatMinor(next) };
    });
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    return { result: "already_recorded" as const };
  }
}

export async function bulkGrantMarks(
  db: Root,
  input: { guildId: string; userIds: readonly string[]; amountMarks: number; reason: string; actorUserId: string; actorRoleIds: readonly string[]; batchId: string; now: Date },
) {
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "economy_operations" })) !== "allowed") {
    return { result: "denied" as const, grants: [] };
  }
  const grants = [];
  for (const userId of input.userIds) {
    const issued = await issueMarks(db, {
      guildId: input.guildId,
      userId,
      amountMarks: input.amountMarks,
      source: "staff_bulk",
      sourceId: input.batchId,
      pace: "routine",
      idempotencyKey: `bulk:${input.batchId}:${userId}`,
      reason: input.reason,
      actorUserId: input.actorUserId,
      now: input.now,
    });
    grants.push({ userId, result: issued.result });
  }
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "economy.bulk",
    targetType: "wallet",
    targetId: input.batchId,
    reason: input.reason,
  });
  return { result: "processed" as const, grants };
}

export async function listReceipts(db: Writer, input: { guildId: string; userId: string; audience: "member" | "staff" }) {
  const entries = await db.ledgerEntry.findMany({
    where: { guildId: input.guildId, userId: input.userId },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  return entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    direction: entry.direction,
    amount: formatMinor(entry.amountMinor),
    source: entry.source,
    createdAt: entry.createdAt.toISOString(),
    ...(input.audience === "staff" ? { reason: entry.reason } : {}),
  }));
}

export async function economyReport(db: Writer, guildId: string) {
  const entries = await db.ledgerEntry.findMany({ where: { guildId } });
  const wallets = await db.wallet.findMany({ where: { guildId, currency: CURRENCY } });
  const sum = (kind: string, direction?: string) => entries
    .filter((entry) => entry.kind === kind && entry.userId !== "system" && (direction === undefined || entry.direction === direction))
    .reduce((total, entry) => total + entry.amountMinor, 0n);
  const escrow = wallets.reduce((total, wallet) => total + wallet.escrowMinor, 0n);
  return {
    status: "ready" as const,
    marksIssued: formatMinor(sum("issue")),
    marksReversed: formatMinor(sum("reversal")),
    marksSpent: formatMinor(sum("escrow_commit") + sum("adjust", "debit")),
    transferCount: entries.filter((entry) => entry.kind === "transfer_out").length,
    escrow: formatMinor(escrow),
    wallets: wallets.filter((wallet) => wallet.userId !== "system" && wallet.userId !== "treasury" && wallet.userId !== "bot").length,
    entryCount: entries.length,
  };
}

export async function exportEconomyReport(
  db: Writer,
  input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; reason: string },
) {
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "statistics" })) !== "allowed") {
    return { result: "denied" as const };
  }
  const report = await economyReport(db, input.guildId);
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "economy.export",
    targetType: "ledger",
    targetId: input.guildId,
    reason: input.reason,
  });
  return { result: "exported" as const, report };
}

export async function postContractIssue(tx: Tx, input: {
  guildId: string;
  userId: string;
  amountMarks: number;
  subcapMarks: number;
  subcapScope: "contract_daily" | "contract_weekly" | "contract_monthly";
  subcapPeriod: string;
  source: string;
  sourceId: string;
  idempotencyKey: string;
  reason: string;
  actorUserId: string;
  now: Date;
}) {
  const amountMinor = marksToMinor(input.amountMarks);
  const capMinor = marksToMinor(input.subcapMarks);
  if (amountMinor === null || amountMinor <= 0n || capMinor === null || capMinor <= 0n || input.userId === "treasury" || input.userId === "bot" || input.userId === "system") {
    return { result: "invalid" as const, amountMarks: 0, reduced: false };
  }
  const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    const amountMarks = Number(existing.amountMinor / 100n);
    return { result: "already_recorded" as const, entryId: existing.id, amountMarks, reduced: existing.amountMinor < amountMinor };
  }
  const settings = await settingsOf(tx, input.guildId);
  const period = perthPeriod(input.now);
  const routine = routineMonthlyMarks();
  const memberCap = marksToMinor(routine.routineMarks) ?? 0n;
  const guildCap = marksToMinor(settings.guildRoutineMarks) ?? 0n;
  const guildBudget = await lockBudget(tx, input.guildId, "guild_routine", period, "guild", guildCap);
  const memberBudget = await lockBudget(tx, input.guildId, "member_routine", period, input.userId, memberCap);
  const subcap = await lockBudget(tx, input.guildId, input.subcapScope, input.subcapPeriod, input.userId, capMinor);
  const rooms: Array<{ scope: "guild" | "member" | "contract"; room: bigint }> = [
    { scope: "guild", room: guildBudget.authorizedMinor - guildBudget.spentMinor },
    { scope: "member", room: memberBudget.authorizedMinor - memberBudget.spentMinor },
    { scope: "contract", room: subcap.authorizedMinor - subcap.spentMinor },
  ];
  let payable = amountMinor;
  let tight: "guild" | "member" | "contract" = "contract";
  for (const room of rooms) {
    const available = room.room > 0n ? room.room : 0n;
    if (available < payable) {
      payable = available;
      tight = room.scope;
    }
  }
  payable -= payable % 100n;
  if (payable <= 0n) {
    return { result: "capped" as const, amountMarks: 0, reduced: false, scope: tight };
  }
  await addSpent(tx, memberBudget, payable);
  await addSpent(tx, guildBudget, payable);
  await addSpent(tx, subcap, payable);
  const wallet = await lockWallet(tx, input.guildId, input.userId);
  await setAvailable(tx, input.guildId, input.userId, wallet.availableMinor + payable, wallet.escrowMinor);
  const entry = await writeEntry(tx, {
    guildId: input.guildId,
    userId: input.userId,
    direction: "credit",
    kind: "issue",
    amountMinor: payable,
    source: input.source,
    sourceId: input.sourceId,
    pace: "routine",
    idempotencyKey: input.idempotencyKey,
    reason: payable < amountMinor ? `${input.reason} Reduced to the remaining routine cap.` : input.reason,
    actorUserId: input.actorUserId,
    now: input.now,
  });
  return { result: "posted" as const, entryId: entry.id, amountMarks: Number(payable / 100n), reduced: payable < amountMinor };
}

export async function postCharacterFee(tx: Tx, input: {
  guildId: string;
  userId: string;
  amountMarks: number;
  source: string;
  sourceId: string;
  idempotencyKey: string;
  reason: string;
  actorUserId: string;
  now: Date;
}) {
  const amountMinor = marksToMinor(input.amountMarks);
  if (amountMinor === null || amountMinor <= 0n) {
    return { result: "invalid" as const, balanceMarks: 0 };
  }
  const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    const wallet = await lockWallet(tx, input.guildId, input.userId);
    return { result: "already_recorded" as const, balanceMarks: Number(wallet.availableMinor / 100n) };
  }
  const wallet = await lockWallet(tx, input.guildId, input.userId);
  if (wallet.availableMinor < amountMinor) {
    return { result: "insufficient" as const, balanceMarks: Number(wallet.availableMinor / 100n) };
  }
  const next = wallet.availableMinor - amountMinor;
  await setAvailable(tx, input.guildId, input.userId, next, wallet.escrowMinor);
  await writeEntry(tx, {
    guildId: input.guildId,
    userId: input.userId,
    direction: "debit",
    kind: "service",
    amountMinor,
    source: input.source,
    sourceId: input.sourceId,
    pace: "service",
    idempotencyKey: input.idempotencyKey,
    reason: input.reason,
    actorUserId: input.actorUserId,
    now: input.now,
  });
  return { result: "posted" as const, balanceMarks: Number(next / 100n) };
}

export async function holdMarksPair(
  db: Root,
  input: { guildId: string; leftUserId: string; rightUserId: string; amountMarks: number; idempotencyKey: string; reason: string; now: Date },
) {
  const amountMinor = marksToMinor(input.amountMarks);
  if (amountMinor === null || amountMinor < 0n) {
    return { result: "invalid" as const };
  }
  if (amountMinor === 0n) {
    return { result: "skipped" as const };
  }
  const [first, second] = [input.leftUserId, input.rightUserId].sort();
  if (!first || !second || first === second) {
    return { result: "invalid" as const };
  }
  try {
    return await db.$transaction(async (tx) => {
      const leftKey = `${input.idempotencyKey}:${input.leftUserId}`;
      const rightKey = `${input.idempotencyKey}:${input.rightUserId}`;
      const leftExisting = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: leftKey } });
      const rightExisting = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: rightKey } });
      if (leftExisting && rightExisting) {
        return { result: "already_recorded" as const };
      }
      const lockedFirst = await lockWallet(tx, input.guildId, first);
      const lockedSecond = await lockWallet(tx, input.guildId, second);
      const left = input.leftUserId === first ? lockedFirst : lockedSecond;
      const right = input.rightUserId === first ? lockedFirst : lockedSecond;
      if (left.availableMinor < amountMinor || right.availableMinor < amountMinor) {
        return { result: "insufficient" as const };
      }
      await setAvailable(tx, input.guildId, input.leftUserId, left.availableMinor - amountMinor, left.escrowMinor + amountMinor);
      await setAvailable(tx, input.guildId, input.rightUserId, right.availableMinor - amountMinor, right.escrowMinor + amountMinor);
      await writeEntry(tx, { guildId: input.guildId, userId: input.leftUserId, direction: "debit", kind: "escrow_hold", amountMinor, source: "wager", sourceId: input.idempotencyKey, pace: "escrow", idempotencyKey: leftKey, reason: input.reason, actorUserId: input.leftUserId, now: input.now });
      await writeEntry(tx, { guildId: input.guildId, userId: input.rightUserId, direction: "debit", kind: "escrow_hold", amountMinor, source: "wager", sourceId: input.idempotencyKey, pace: "escrow", idempotencyKey: rightKey, reason: input.reason, actorUserId: input.rightUserId, now: input.now });
      return { result: "held" as const };
    });
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    return { result: "already_recorded" as const };
  }
}

export async function settleWager(
  db: Root,
  input: { guildId: string; leftUserId: string; rightUserId: string; winnerUserId: string; amountMarks: number; idempotencyKey: string; outcome: "pot" | "refund"; now: Date },
) {
  const amountMinor = marksToMinor(input.amountMarks);
  if (amountMinor === null || amountMinor < 0n) {
    return { result: "invalid" as const };
  }
  if (amountMinor === 0n) {
    return { result: "skipped" as const };
  }
  const [first, second] = [input.leftUserId, input.rightUserId].sort();
  if (!first || !second) {
    return { result: "invalid" as const };
  }
  try {
    return await db.$transaction(async (tx) => {
      const gate = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: `${input.idempotencyKey}:gate` } });
      if (gate) {
        return { result: "already_recorded" as const };
      }
      const lockedFirst = await lockWallet(tx, input.guildId, first);
      const lockedSecond = await lockWallet(tx, input.guildId, second);
      const left = input.leftUserId === first ? lockedFirst : lockedSecond;
      const right = input.rightUserId === first ? lockedFirst : lockedSecond;
      if (left.escrowMinor < amountMinor || right.escrowMinor < amountMinor) {
        return { result: "insufficient" as const };
      }
      if (input.outcome === "refund") {
        await setAvailable(tx, input.guildId, input.leftUserId, left.availableMinor + amountMinor, left.escrowMinor - amountMinor);
        await setAvailable(tx, input.guildId, input.rightUserId, right.availableMinor + amountMinor, right.escrowMinor - amountMinor);
        await writeEntry(tx, { guildId: input.guildId, userId: input.leftUserId, direction: "credit", kind: "escrow_release", amountMinor, source: "wager", sourceId: input.idempotencyKey, pace: "escrow", idempotencyKey: `${input.idempotencyKey}:refund:${input.leftUserId}`, reason: "Wager refund", actorUserId: "system", now: input.now });
        await writeEntry(tx, { guildId: input.guildId, userId: input.rightUserId, direction: "credit", kind: "escrow_release", amountMinor, source: "wager", sourceId: input.idempotencyKey, pace: "escrow", idempotencyKey: `${input.idempotencyKey}:gate`, reason: "Wager refund", actorUserId: "system", now: input.now });
        return { result: "refunded" as const };
      }
      const winnerId = input.winnerUserId === input.leftUserId || input.winnerUserId === input.rightUserId ? input.winnerUserId : "";
      const loserId = winnerId === input.leftUserId ? input.rightUserId : input.leftUserId;
      if (!winnerId) {
        return { result: "invalid" as const };
      }
      const winner = winnerId === input.leftUserId ? left : right;
      const loser = loserId === input.leftUserId ? left : right;
      await setAvailable(tx, input.guildId, winnerId, winner.availableMinor + amountMinor + amountMinor, winner.escrowMinor - amountMinor);
      await setAvailable(tx, input.guildId, loserId, loser.availableMinor, loser.escrowMinor - amountMinor);
      await writeEntry(tx, { guildId: input.guildId, userId: winnerId, direction: "credit", kind: "escrow_release", amountMinor, source: "wager", sourceId: input.idempotencyKey, pace: "escrow", idempotencyKey: `${input.idempotencyKey}:return`, reason: "Wager stake returned", actorUserId: "system", now: input.now });
      await writeEntry(tx, { guildId: input.guildId, userId: loserId, direction: "debit", kind: "escrow_commit", amountMinor, source: "wager", sourceId: winnerId, pace: "escrow", idempotencyKey: `${input.idempotencyKey}:pot`, reason: "Wager stake paid to the winner", actorUserId: "system", now: input.now });
      await writeEntry(tx, { guildId: input.guildId, userId: winnerId, direction: "credit", kind: "wager_in", amountMinor, source: "wager", sourceId: loserId, pace: "escrow", idempotencyKey: `${input.idempotencyKey}:gate`, reason: "Wager pot", actorUserId: "system", now: input.now });
      return { result: "paid" as const };
    });
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    return { result: "already_recorded" as const };
  }
}

export async function marksLeaderboardRows(db: Writer, guildId: string) {
  const wallets = await db.wallet.findMany({ where: { guildId, currency: CURRENCY } });
  return wallets
    .filter((wallet) => wallet.userId !== "system" && wallet.userId !== "treasury" && wallet.userId !== "bot")
    .map((wallet) => ({ userId: wallet.userId, score: Number((wallet.availableMinor + wallet.escrowMinor) / 100n) }));
}

export { emptyPublicWallet };
