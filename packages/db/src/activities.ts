import { randomInt, randomUUID } from "node:crypto";

import {
  HOUSE_FEE_BPS,
  PREDICTION_RULES,
  SHOP_KEY_DETAIL,
  bonusDecision,
  drawWinners,
  entryEligibility,
  marksHoldDecision,
  mediaAllowed,
  perthPeriod,
  splitPool,
  tiedLeaders,
  weightedScore,
} from "@collective/domain";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

import { moveHeldCurrency, reverseMarks } from "./ledger.js";
import { assignVaultKey } from "./shop.js";
import { actorCan, enqueueJob, ensureGuild, moduleIsAvailable, writeAudit, type Writer } from "./platform.js";

type Root = PrismaClient;
type Tx = Prisma.TransactionClient;

const MARK_MINOR = 100n;

class ActivityRollback extends Error {
  constructor(readonly code: "insufficient") {
    super(code);
  }
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function text(value: string, max: number): string | null {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > max) {
    return null;
  }
  return trimmed;
}

function minor(marks: number): bigint | null {
  if (!Number.isSafeInteger(marks) || marks < 0) {
    return null;
  }
  return BigInt(marks) * MARK_MINOR;
}

function secureIndex(max: number): number {
  return randomInt(0, max);
}

async function staff(db: Writer, input: { guildId: string; actorRoleIds: readonly string[] }): Promise<"ok" | "denied" | "maintenance"> {
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "event_management" })) !== "allowed") {
    return "denied";
  }
  if (!(await moduleIsAvailable(db, input.guildId, "events"))) {
    return "maintenance";
  }
  return "ok";
}

async function opened(db: Writer, guildId: string): Promise<"ok" | "maintenance"> {
  return (await moduleIsAvailable(db, guildId, "events")) ? "ok" : "maintenance";
}

function scoreMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const scores: Record<string, number> = {};
  for (const [key, score] of Object.entries(value)) {
    if (typeof score === "number" && Number.isSafeInteger(score)) {
      scores[key] = score;
    }
  }
  return scores;
}

function ticketsFrom(snapshot: unknown): { entryId: string; userId: string; kind: string }[] {
  if (!snapshot || typeof snapshot !== "object" || !("tickets" in snapshot) || !Array.isArray(snapshot.tickets)) {
    return [];
  }
  return snapshot.tickets.flatMap((ticket) => {
    if (!ticket || typeof ticket !== "object" || !("userId" in ticket) || typeof ticket.userId !== "string") {
      return [];
    }
    const entryId = "entryId" in ticket && typeof ticket.entryId === "string" ? ticket.entryId : "";
    const kind = "kind" in ticket && typeof ticket.kind === "string" ? ticket.kind : "free";
    return [{ entryId, userId: ticket.userId, kind }];
  });
}

async function walletMove(tx: Tx, input: {
  guildId: string;
  userId: string;
  availableDelta: bigint;
  escrowDelta: bigint;
  kind: string;
  direction: "credit" | "debit";
  amountMinor: bigint;
  source: string;
  sourceId: string;
  idempotencyKey: string;
  reason: string;
  actorUserId: string;
  now: Date;
  pace?: string;
}) {
  return moveHeldCurrency(tx, {
    guildId: input.guildId,
    userId: input.userId,
    currency: "marks",
    availableDelta: input.availableDelta,
    escrowDelta: input.escrowDelta,
    kind: input.kind,
    direction: input.direction,
    amountMinor: input.amountMinor,
    source: input.source,
    sourceId: input.sourceId,
    pace: input.pace ?? "escrow",
    idempotencyKey: input.idempotencyKey,
    reason: input.reason,
    actorUserId: input.actorUserId,
    now: input.now,
  });
}

export async function createPrediction(
  db: Root,
  input: {
    guildId: string;
    title: string;
    mode: "free" | "staked";
    rules: string;
    evidence: string;
    outcomes: readonly string[];
    lockAt: Date;
    points?: number;
    prizeMarks?: number;
    requiredRoleId?: string;
    minAccountDays?: number;
    attendanceOccurrenceId?: string;
    actorUserId: string;
    actorRoleIds: readonly string[];
    now: Date;
  },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const title = text(input.title, 80);
  const rules = text(input.rules, 1000);
  const evidence = text(input.evidence, 1000);
  const labels = input.outcomes.map((label) => text(label, 80));
  const points = input.points ?? 1;
  const prizeMarks = input.prizeMarks ?? 0;
  if (
    !title || !rules || !evidence || input.mode !== "free" && input.mode !== "staked" ||
    labels.length < 2 || labels.length > 10 || labels.some((label) => !label) ||
    new Set(labels).size !== labels.length || input.lockAt.getTime() <= input.now.getTime() ||
    !Number.isSafeInteger(points) || points < 0 || points > 100 ||
    !Number.isSafeInteger(prizeMarks) || prizeMarks < 0
  ) {
    return { result: "invalid" as const };
  }
  await ensureGuild(db, { guildId: input.guildId });
  const id = randomUUID();
  const outcomes = labels.map((label, position) => ({ id: randomUUID(), guildId: input.guildId, predictionId: id, label: label ?? "", position }));
  await db.prediction.create({
    data: {
      id,
      guildId: input.guildId,
      title,
      mode: input.mode,
      rules,
      evidence,
      requiredRoleId: input.requiredRoleId?.trim() ?? "",
      minAccountDays: input.minAccountDays ?? 0,
      attendanceOccurrenceId: input.attendanceOccurrenceId?.trim() ?? "",
      lockAt: input.lockAt,
      status: "open",
      points,
      prizeMarks,
      houseFeeBps: HOUSE_FEE_BPS,
      updatedAt: input.now,
    },
  });
  await db.predictionOutcome.createMany({ data: outcomes });
  await enqueueJob(db, {
    guildId: input.guildId,
    jobType: "prediction.lock",
    payload: { predictionId: id },
    idempotencyKey: `prediction-lock:${id}`,
    runAt: input.lockAt,
  });
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "prediction.create",
    targetType: "prediction",
    targetId: id,
    reason: input.mode === "free" ? "Open a free prediction" : "Open a staked prediction",
  });
  return { result: "open" as const, prediction: { id, houseFeeBps: HOUSE_FEE_BPS }, outcomes, rules: PREDICTION_RULES };
}

export async function editPredictionOutcomes(
  db: Root,
  input: { guildId: string; predictionId: string; outcomes: readonly string[]; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const labels = input.outcomes.map((label) => text(label, 80));
  if (labels.length < 2 || labels.some((label) => !label) || new Set(labels).size !== labels.length) {
    return { result: "invalid" as const };
  }
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "prediction" WHERE "id" = ${input.predictionId} FOR UPDATE`;
    const prediction = await tx.prediction.findUnique({ where: { id: input.predictionId } });
    if (!prediction || prediction.guildId !== input.guildId) {
      return { result: "missing" as const };
    }
    const entries = await tx.predictionEntry.count({ where: { predictionId: prediction.id } });
    if (prediction.status !== "open" || input.now >= prediction.lockAt || entries > 0) {
      return { result: "locked" as const };
    }
    await tx.predictionOutcome.deleteMany({ where: { predictionId: prediction.id } });
    await tx.predictionOutcome.createMany({
      data: labels.map((label, position) => ({ id: randomUUID(), guildId: input.guildId, predictionId: prediction.id, label: label ?? "", position })),
    });
    return { result: "updated" as const };
  });
}

export async function readPrediction(db: Writer, input: { guildId: string; predictionId: string }) {
  if ((await opened(db, input.guildId)) !== "ok") {
    return { result: "maintenance" as const };
  }
  const prediction = await db.prediction.findUnique({ where: { id: input.predictionId } });
  if (!prediction || prediction.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  const outcomes = await db.predictionOutcome.findMany({ where: { predictionId: prediction.id }, orderBy: { position: "asc" } });
  return {
    result: "ok" as const,
    prediction: {
      id: prediction.id,
      title: prediction.title,
      mode: prediction.mode,
      rules: prediction.rules,
      evidence: prediction.evidence,
      lockAt: prediction.lockAt,
      status: prediction.status,
      prizeMarks: prediction.prizeMarks,
      points: prediction.points,
      houseFeeBps: prediction.houseFeeBps,
      resolutionRule: prediction.resolutionRule,
      resolutionEvidence: prediction.status === "open" ? "" : prediction.resolutionEvidence,
    },
    outcomes: outcomes.map((outcome) => ({ id: outcome.id, label: outcome.label })),
    settlement: PREDICTION_RULES,
  };
}

export async function enterPrediction(
  db: Root,
  input: {
    guildId: string;
    predictionId: string;
    userId: string;
    outcomeId: string;
    stakeMarks: number;
    roleIds: readonly string[];
    accountAgeDays: number;
    acknowledged: boolean;
    now: Date;
  },
) {
  if ((await opened(db, input.guildId)) !== "ok") {
    return { result: "maintenance" as const };
  }
  const located = await db.prediction.findUnique({ where: { id: input.predictionId } });
  if (!located || located.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  const outcomes = await db.predictionOutcome.findMany({ where: { predictionId: located.id }, orderBy: { position: "asc" } });
  const disclosure = {
    title: located.title,
    rules: located.rules,
    evidence: located.evidence,
    lockAt: located.lockAt,
    outcomes: outcomes.map((outcome) => ({ id: outcome.id, label: outcome.label })),
    houseFeeBps: located.houseFeeBps,
    prizeMarks: located.prizeMarks,
    settlement: PREDICTION_RULES,
  };
  if (!input.acknowledged) {
    return { result: "preview" as const, ...disclosure };
  }
  const stakeMarks = located.mode === "free" ? 0 : input.stakeMarks;
  if (located.mode === "staked" && (!Number.isSafeInteger(stakeMarks) || stakeMarks < 1 || stakeMarks > 100_000)) {
    return { result: "invalid" as const };
  }
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "prediction" WHERE "id" = ${located.id} FOR UPDATE`;
      const prediction = await tx.prediction.findUnique({ where: { id: located.id } });
      if (!prediction || prediction.status === "cancelled" || prediction.status === "resolved" || prediction.status === "reversed" || prediction.status === "unfunded") {
        return { result: "closed" as const };
      }
      if (prediction.status !== "open" || input.now >= prediction.lockAt) {
        if (prediction.status === "open") {
          await tx.prediction.update({ where: { id: prediction.id }, data: { status: "locked", updatedAt: input.now } });
        }
        return { result: "locked" as const };
      }
      const choice = outcomes.find((outcome) => outcome.id === input.outcomeId);
      if (!choice) {
        return { result: "missing" as const };
      }
      const attendance = prediction.attendanceOccurrenceId
        ? (await tx.eventRsvp.findUnique({ where: { occurrenceId_userId: { occurrenceId: prediction.attendanceOccurrenceId, userId: input.userId } } }))?.attended === true
        : true;
      const eligible = entryEligibility({
        requiredRoleId: prediction.requiredRoleId,
        roleIds: input.roleIds,
        minAccountDays: prediction.minAccountDays,
        accountAgeDays: input.accountAgeDays,
        attendanceRequired: prediction.attendanceOccurrenceId.length > 0,
        attended: attendance,
      });
      if (eligible !== "allowed") {
        return { result: eligible };
      }
      const existing = await tx.predictionEntry.findUnique({ where: { predictionId_userId: { predictionId: prediction.id, userId: input.userId } } });
      if (existing) {
        if (existing.stakeMarks !== stakeMarks) {
          return { result: "stake_fixed" as const };
        }
        await tx.predictionEntry.update({ where: { id: existing.id }, data: { outcomeId: choice.id, updatedAt: input.now } });
        return { result: "recorded" as const, ...disclosure };
      }
      if (stakeMarks > 0) {
        const amount = minor(stakeMarks);
        if (!amount) {
          return { result: "invalid" as const };
        }
        const wallet = await tx.wallet.findUnique({ where: { guildId_userId_currency: { guildId: input.guildId, userId: input.userId, currency: "marks" } } });
        if (marksHoldDecision(wallet?.availableMinor ?? 0n, amount) !== "allowed") {
          return { result: "insufficient" as const };
        }
        const held = await walletMove(tx, {
          guildId: input.guildId,
          userId: input.userId,
          availableDelta: -amount,
          escrowDelta: amount,
          kind: "escrow_hold",
          direction: "debit",
          amountMinor: amount,
          source: "prediction",
          sourceId: prediction.id,
          idempotencyKey: `prediction.hold:${prediction.id}:${input.userId}`,
          reason: "Prediction stake",
          actorUserId: input.userId,
          now: input.now,
        });
        if (held === "insufficient") {
          return { result: "insufficient" as const };
        }
      }
      await tx.predictionEntry.create({
        data: {
          id: randomUUID(),
          guildId: input.guildId,
          predictionId: prediction.id,
          userId: input.userId,
          outcomeId: choice.id,
          stakeMarks,
          status: "active",
          updatedAt: input.now,
        },
      });
      return { result: "recorded" as const, ...disclosure };
    });
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    return { result: "already_recorded" as const };
  }
}

export async function lockDuePrediction(db: Root, predictionId: string, now: Date, force = false) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "prediction" WHERE "id" = ${predictionId} FOR UPDATE`;
    const prediction = await tx.prediction.findUnique({ where: { id: predictionId } });
    if (!prediction) {
      return { result: "missing" as const };
    }
    if (prediction.status !== "open") {
      return { result: "already_locked" as const };
    }
    if (!force && now < prediction.lockAt) {
      return { result: "open" as const };
    }
    await tx.prediction.update({ where: { id: prediction.id }, data: { status: "locked", updatedAt: now } });
    return { result: "locked" as const };
  });
}

export async function lockPrediction(
  db: Root,
  input: { guildId: string; predictionId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const locked = await lockDuePrediction(db, input.predictionId, input.now, true);
  if (locked.result === "locked") {
    await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "prediction.lock", targetType: "prediction", targetId: input.predictionId, reason: "Lock prediction entries" });
  }
  return locked;
}

async function refundEntries(tx: Tx, input: { guildId: string; predictionId: string; actorUserId: string; now: Date }) {
  const entries = await tx.predictionEntry.findMany({ where: { predictionId: input.predictionId, status: "active" } });
  for (const entry of entries) {
    if (entry.stakeMarks > 0) {
      const amount = minor(entry.stakeMarks);
      if (!amount) {
        throw new ActivityRollback("insufficient");
      }
      const moved = await walletMove(tx, {
        guildId: input.guildId,
        userId: entry.userId,
        availableDelta: amount,
        escrowDelta: -amount,
        kind: "escrow_release",
        direction: "credit",
        amountMinor: amount,
        source: "prediction",
        sourceId: input.predictionId,
        idempotencyKey: `prediction.release:${input.predictionId}:${entry.userId}`,
        reason: "Prediction stake refund",
        actorUserId: input.actorUserId,
        now: input.now,
      });
      if (moved === "insufficient") {
        throw new ActivityRollback("insufficient");
      }
    }
    await tx.predictionEntry.update({ where: { id: entry.id }, data: { status: "refunded", payoutMarks: 0, updatedAt: input.now } });
  }
}

async function awardPoints(tx: Tx, input: { guildId: string; predictionId: string; outcomeId: string; points: number; now: Date }) {
  const winners = await tx.predictionEntry.findMany({ where: { predictionId: input.predictionId, outcomeId: input.outcomeId, status: "active" } });
  for (const entry of winners) {
    if (entry.pointsAwarded > 0 || input.points < 1) {
      continue;
    }
    const score = await tx.predictionScore.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: entry.userId } } });
    if (score) {
      await tx.predictionScore.update({ where: { id: score.id }, data: { points: score.points + input.points, updatedAt: input.now } });
    } else {
      await tx.predictionScore.create({ data: { id: randomUUID(), guildId: input.guildId, userId: entry.userId, points: input.points, updatedAt: input.now } });
    }
    await tx.predictionEntry.update({ where: { id: entry.id }, data: { pointsAwarded: input.points, updatedAt: input.now } });
  }
  return winners;
}

async function payExceptional(tx: Tx, input: {
  guildId: string;
  predictionId: string;
  payouts: readonly { userId: string; payout: number }[];
  actorUserId: string;
  now: Date;
}) {
  const total = input.payouts.reduce((sum, row) => sum + row.payout, 0);
  const totalMinor = minor(total);
  if (!totalMinor) {
    return "invalid" as const;
  }
  if (total === 0) {
    return "paid" as const;
  }
  const period = perthPeriod(input.now);
  const rows = await tx.$queryRaw<Array<{ authorizedMinor: bigint; spentMinor: bigint }>>`
    SELECT "authorizedMinor", "spentMinor" FROM "issuance_budget"
    WHERE "guildId" = ${input.guildId} AND "scope" = 'exceptional' AND "periodKey" = ${period} AND "subjectId" = 'guild'
    FOR UPDATE
  `;
  const pool = rows[0];
  if (!pool || pool.authorizedMinor - pool.spentMinor < totalMinor) {
    return "unfunded" as const;
  }
  let spent = 0n;
  for (const row of input.payouts) {
    if (row.payout < 1) {
      continue;
    }
    const amount = minor(row.payout);
    if (!amount) {
      return "invalid" as const;
    }
    const moved = await walletMove(tx, {
      guildId: input.guildId,
      userId: row.userId,
      availableDelta: amount,
      escrowDelta: 0n,
      kind: "issue",
      direction: "credit",
      amountMinor: amount,
      source: "prediction.prize",
      sourceId: input.predictionId,
      idempotencyKey: `prediction.prize:${input.predictionId}:${row.userId}`,
      reason: "Funded prediction prize",
      actorUserId: input.actorUserId,
      now: input.now,
      pace: "exceptional",
    });
    if (moved === "insufficient") {
      throw new ActivityRollback("insufficient");
    }
    if (moved === "ok") {
      spent += amount;
    }
    await tx.predictionEntry.updateMany({
      where: { predictionId: input.predictionId, userId: row.userId },
      data: { payoutMarks: row.payout, status: "paid", updatedAt: input.now },
    });
  }
  if (spent > 0n) {
    await tx.$executeRaw`
      UPDATE "issuance_budget"
      SET "spentMinor" = "spentMinor" + ${spent}, "updatedAt" = NOW()
      WHERE "guildId" = ${input.guildId} AND "scope" = 'exceptional' AND "periodKey" = ${period} AND "subjectId" = 'guild'
    `;
  }
  return "paid" as const;
}

export async function resolvePrediction(
  db: Root,
  input: { guildId: string; predictionId: string; outcomeId: string; evidence: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const evidence = text(input.evidence, 1000);
  if (!evidence) {
    return { result: "invalid" as const };
  }
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "prediction" WHERE "id" = ${input.predictionId} FOR UPDATE`;
      const prediction = await tx.prediction.findUnique({ where: { id: input.predictionId } });
      if (!prediction || prediction.guildId !== input.guildId) {
        return { result: "missing" as const };
      }
      if (prediction.status === "resolved" || prediction.status === "unfunded") {
        return { result: "already_resolved" as const, rule: prediction.resolutionRule };
      }
      if (prediction.status === "cancelled" || prediction.status === "reversed") {
        return { result: prediction.status };
      }
      if (prediction.status === "open" && input.now < prediction.lockAt) {
        return { result: "open" as const };
      }
      if (prediction.status === "open") {
        await tx.prediction.update({ where: { id: prediction.id }, data: { status: "locked", updatedAt: input.now } });
      }
      const outcomeId = input.outcomeId.trim();
      if (outcomeId === "tie") {
        await refundEntries(tx, { guildId: input.guildId, predictionId: prediction.id, actorUserId: input.actorUserId, now: input.now });
        await tx.prediction.update({
          where: { id: prediction.id },
          data: { status: "resolved", resolutionEvidence: evidence, resolutionRule: "tie", winningOutcomeId: "", updatedAt: input.now },
        });
        await writeAudit(tx, { guildId: input.guildId, actorUserId: input.actorUserId, action: "prediction.resolve", targetType: "prediction", targetId: prediction.id, reason: evidence });
        return { result: "refunded" as const, rule: "tie" as const };
      }
      const outcome = await tx.predictionOutcome.findUnique({ where: { id: outcomeId } });
      if (!outcome || outcome.predictionId !== prediction.id) {
        return { result: "missing" as const };
      }
      const winners = await tx.predictionEntry.findMany({ where: { predictionId: prediction.id, outcomeId: outcome.id, status: "active" } });
      if (winners.length === 0) {
        await refundEntries(tx, { guildId: input.guildId, predictionId: prediction.id, actorUserId: input.actorUserId, now: input.now });
        await tx.prediction.update({
          where: { id: prediction.id },
          data: { status: "resolved", resolutionEvidence: evidence, resolutionRule: "no_winner", winningOutcomeId: outcome.id, updatedAt: input.now },
        });
        await writeAudit(tx, { guildId: input.guildId, actorUserId: input.actorUserId, action: "prediction.resolve", targetType: "prediction", targetId: prediction.id, reason: evidence });
        return { result: "refunded" as const, rule: "no_winner" as const };
      }
      if (prediction.mode === "free") {
        const shares = splitPool(BigInt(prediction.prizeMarks), winners.map((winner) => ({ userId: winner.userId, stake: 1n })));
        if (!shares) {
          return { result: "invalid" as const };
        }
        await awardPoints(tx, { guildId: input.guildId, predictionId: prediction.id, outcomeId: outcome.id, points: prediction.points, now: input.now });
        const paid = await payExceptional(tx, {
          guildId: input.guildId,
          predictionId: prediction.id,
          payouts: shares.flatMap((share) => {
            const payout = Number(share.payout);
            return Number.isSafeInteger(payout) ? [{ userId: share.userId, payout }] : [];
          }),
          actorUserId: input.actorUserId,
          now: input.now,
        });
        const rule = paid === "unfunded" ? "unfunded" : prediction.prizeMarks > 0 ? "proportional" : "points";
        await tx.prediction.update({
          where: { id: prediction.id },
          data: { status: paid === "unfunded" ? "unfunded" : "resolved", resolutionEvidence: evidence, resolutionRule: rule, winningOutcomeId: outcome.id, updatedAt: input.now },
        });
        await writeAudit(tx, { guildId: input.guildId, actorUserId: input.actorUserId, action: "prediction.resolve", targetType: "prediction", targetId: prediction.id, reason: evidence });
        return { result: paid === "unfunded" ? "unfunded" as const : "resolved" as const, rule };
      }
      const entries = await tx.predictionEntry.findMany({ where: { predictionId: prediction.id, status: "active" } });
      const pool = entries.reduce((sum, entry) => sum + BigInt(entry.stakeMarks), 0n);
      const shares = splitPool(pool, winners.map((winner) => ({ userId: winner.userId, stake: BigInt(winner.stakeMarks) })));
      if (!shares) {
        return { result: "invalid" as const };
      }
      const payoutOf = new Map(shares.map((share) => [share.userId, share.payout]));
      for (const entry of entries) {
        const payout = payoutOf.get(entry.userId) ?? 0n;
        const stakeMinor = minor(entry.stakeMarks);
        const payoutMarks = Number(payout);
        const payoutMinor = minor(payoutMarks);
        if (!stakeMinor || payoutMinor === null || !Number.isSafeInteger(payoutMarks)) {
          return { result: "invalid" as const };
        }
        if (payout > 0n) {
          const moved = await walletMove(tx, {
            guildId: input.guildId,
            userId: entry.userId,
            availableDelta: payoutMinor,
            escrowDelta: -stakeMinor,
            kind: "prediction_payout",
            direction: "credit",
            amountMinor: payoutMinor,
            source: "prediction.pool",
            sourceId: prediction.id,
            idempotencyKey: `prediction.payout:${prediction.id}:${entry.userId}`,
            reason: "Prediction pool payout",
            actorUserId: input.actorUserId,
            now: input.now,
          });
          if (moved === "insufficient") {
            throw new ActivityRollback("insufficient");
          }
          await tx.predictionEntry.update({ where: { id: entry.id }, data: { status: "paid", payoutMarks, updatedAt: input.now } });
        } else {
          const moved = await walletMove(tx, {
            guildId: input.guildId,
            userId: entry.userId,
            availableDelta: 0n,
            escrowDelta: -stakeMinor,
            kind: "escrow_commit",
            direction: "debit",
            amountMinor: stakeMinor,
            source: "prediction.pool",
            sourceId: prediction.id,
            idempotencyKey: `prediction.commit:${prediction.id}:${entry.userId}`,
            reason: "Prediction stake committed",
            actorUserId: input.actorUserId,
            now: input.now,
          });
          if (moved === "insufficient") {
            throw new ActivityRollback("insufficient");
          }
          await tx.predictionEntry.update({ where: { id: entry.id }, data: { status: "lost", payoutMarks: 0, updatedAt: input.now } });
        }
      }
      await tx.prediction.update({
        where: { id: prediction.id },
        data: { status: "resolved", resolutionEvidence: evidence, resolutionRule: "proportional", winningOutcomeId: outcome.id, updatedAt: input.now },
      });
      await writeAudit(tx, { guildId: input.guildId, actorUserId: input.actorUserId, action: "prediction.resolve", targetType: "prediction", targetId: prediction.id, reason: evidence });
      return { result: "resolved" as const, rule: "proportional" as const };
    });
  } catch (error) {
    if (error instanceof ActivityRollback) {
      return { result: error.code };
    }
    throw error;
  }
}

export async function cancelPrediction(
  db: Root,
  input: { guildId: string; predictionId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "prediction" WHERE "id" = ${input.predictionId} FOR UPDATE`;
      const prediction = await tx.prediction.findUnique({ where: { id: input.predictionId } });
      if (!prediction || prediction.guildId !== input.guildId) {
        return { result: "missing" as const };
      }
      if (prediction.status === "cancelled") {
        return { result: "already_cancelled" as const, rule: "cancel" as const };
      }
      if (prediction.status === "resolved" || prediction.status === "unfunded" || prediction.status === "reversed") {
        return { result: "resolved" as const };
      }
      await refundEntries(tx, { guildId: input.guildId, predictionId: prediction.id, actorUserId: input.actorUserId, now: input.now });
      await tx.prediction.update({
        where: { id: prediction.id },
        data: { status: "cancelled", resolutionRule: "cancel", updatedAt: input.now },
      });
      await writeAudit(tx, { guildId: input.guildId, actorUserId: input.actorUserId, action: "prediction.cancel", targetType: "prediction", targetId: prediction.id, reason: PREDICTION_RULES.cancel });
      return { result: "cancelled" as const, rule: "cancel" as const };
    });
  } catch (error) {
    if (error instanceof ActivityRollback) {
      return { result: error.code };
    }
    throw error;
  }
}

export async function reversePrediction(
  db: Root,
  input: { guildId: string; predictionId: string; reason: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const reason = text(input.reason, 500);
  if (!reason) {
    return { result: "invalid" as const };
  }
  const prediction = await db.prediction.findUnique({ where: { id: input.predictionId } });
  if (!prediction || prediction.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  if (prediction.status === "reversed") {
    return { result: "already_reversed" as const };
  }
  if (prediction.status !== "resolved" && prediction.status !== "unfunded") {
    return { result: "open" as const };
  }
  if (prediction.mode === "free") {
    const paid = await db.predictionEntry.findMany({ where: { predictionId: prediction.id, payoutMarks: { gt: 0 } } });
    for (const entry of paid) {
      const amount = minor(entry.payoutMarks);
      const wallet = await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId: input.guildId, userId: entry.userId, currency: "marks" } } });
      if (!amount || (wallet?.availableMinor ?? 0n) < amount) {
        return { result: "insufficient" as const };
      }
    }
    for (const entry of paid) {
      const reversed = await reverseMarks(db, { idempotencyKey: `prediction.prize:${prediction.id}:${entry.userId}`, reason, actorUserId: input.actorUserId, now: input.now });
      if (reversed.result === "insufficient") {
        return { result: "insufficient" as const };
      }
    }
    await db.$transaction(async (tx) => {
      const entries = await tx.predictionEntry.findMany({ where: { predictionId: prediction.id } });
      for (const entry of entries) {
        if (entry.pointsAwarded > 0) {
          const score = await tx.predictionScore.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: entry.userId } } });
          if (score) {
            await tx.predictionScore.update({ where: { id: score.id }, data: { points: Math.max(0, score.points - entry.pointsAwarded), updatedAt: input.now } });
          }
        }
        await tx.predictionEntry.update({ where: { id: entry.id }, data: { status: "reversed", pointsAwarded: 0, payoutMarks: 0, updatedAt: input.now } });
      }
      await tx.prediction.update({ where: { id: prediction.id }, data: { status: "reversed", resolutionRule: "reversal", updatedAt: input.now } });
      await writeAudit(tx, { guildId: input.guildId, actorUserId: input.actorUserId, action: "prediction.reverse", targetType: "prediction", targetId: prediction.id, reason });
    });
    return { result: "reversed" as const };
  }
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "prediction" WHERE "id" = ${prediction.id} FOR UPDATE`;
      const current = await tx.prediction.findUnique({ where: { id: prediction.id } });
      if (!current || current.status === "reversed") {
        return { result: "already_reversed" as const };
      }
      if (current.status !== "resolved") {
        return { result: "open" as const };
      }
      const entries = await tx.predictionEntry.findMany({ where: { predictionId: current.id } });
      for (const entry of entries) {
        const stake = minor(entry.stakeMarks) ?? 0n;
        const payout = minor(entry.payoutMarks) ?? 0n;
        const delta = stake - payout;
        if (delta >= 0n) {
          continue;
        }
        const wallet = await tx.wallet.findUnique({ where: { guildId_userId_currency: { guildId: input.guildId, userId: entry.userId, currency: "marks" } } });
        if ((wallet?.availableMinor ?? 0n) < -delta) {
          return { result: "insufficient" as const };
        }
      }
      for (const entry of entries) {
        const stake = minor(entry.stakeMarks) ?? 0n;
        const payout = minor(entry.payoutMarks) ?? 0n;
        const delta = stake - payout;
        if (delta !== 0n) {
          const moved = await walletMove(tx, {
            guildId: input.guildId,
            userId: entry.userId,
            availableDelta: delta,
            escrowDelta: 0n,
            kind: "prediction_reversal",
            direction: delta > 0n ? "credit" : "debit",
            amountMinor: delta > 0n ? delta : -delta,
            source: "prediction.pool",
            sourceId: current.id,
            idempotencyKey: `prediction.reverse:${current.id}:${entry.userId}`,
            reason,
            actorUserId: input.actorUserId,
            now: input.now,
          });
          if (moved === "insufficient") {
            throw new ActivityRollback("insufficient");
          }
        }
        await tx.predictionEntry.update({ where: { id: entry.id }, data: { status: "reversed", payoutMarks: 0, updatedAt: input.now } });
      }
      await tx.prediction.update({ where: { id: current.id }, data: { status: "reversed", resolutionRule: "reversal", updatedAt: input.now } });
      await writeAudit(tx, { guildId: input.guildId, actorUserId: input.actorUserId, action: "prediction.reverse", targetType: "prediction", targetId: current.id, reason });
      return { result: "reversed" as const };
    });
  } catch (error) {
    if (error instanceof ActivityRollback) {
      return { result: error.code };
    }
    throw error;
  }
}

export async function savePrizeStock(
  db: Root,
  input: { guildId: string; name: string; kind: "item" | "marks" | "external_key"; onHand: number; marksEach?: number; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const name = text(input.name, 80);
  const marksEach = input.marksEach ?? 0;
  if (
    !name || (input.kind !== "item" && input.kind !== "marks" && input.kind !== "external_key") ||
    !Number.isSafeInteger(input.onHand) || input.onHand < 0 ||
    (input.kind === "external_key" && input.onHand !== 0) ||
    (input.kind === "marks" && (!Number.isSafeInteger(marksEach) || marksEach < 1)) ||
    (input.kind !== "marks" && marksEach !== 0)
  ) {
    return { result: "invalid" as const };
  }
  await ensureGuild(db, { guildId: input.guildId });
  const id = randomUUID();
  await db.prizeStock.create({
    data: {
      id,
      guildId: input.guildId,
      name,
      kind: input.kind,
      onHand: input.onHand,
      marksEach,
      shopStatus: input.kind === "external_key" ? "shop_pending" : "not_applicable",
      updatedAt: input.now,
    },
  });
  await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "stock.save", targetType: "prize_stock", targetId: id, reason: `Stock ${input.kind}` });
  return { result: "stocked" as const, stock: { id, kind: input.kind, shopStatus: input.kind === "external_key" ? "shop_pending" as const : "not_applicable" as const } };
}

async function fulfilStock(tx: Tx, input: {
  guildId: string;
  stockId: string;
  source: string;
  sourceId: string;
  userId: string;
  quantity: number;
  actorUserId: string;
  now: Date;
}) {
  const prior = await tx.prizeFulfilment.findUnique({ where: { source_sourceId_userId: { source: input.source, sourceId: input.sourceId, userId: input.userId } } });
  if (prior) {
    return { result: "already_recorded" as const, status: prior.status, detail: prior.detail };
  }
  await tx.$queryRaw`SELECT "id" FROM "prize_stock" WHERE "id" = ${input.stockId} FOR UPDATE`;
  const stock = await tx.prizeStock.findUnique({ where: { id: input.stockId } });
  if (!stock || stock.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  if (stock.kind === "external_key") {
    const assigned = await assignVaultKey(tx, { guildId: input.guildId, userId: input.userId, source: input.source, sourceId: input.sourceId, now: input.now });
    if (assigned.result === "assigned") {
      const created = await tx.prizeFulfilment.create({
        data: {
          id: randomUUID(),
          guildId: input.guildId,
          stockId: stock.id,
          source: input.source,
          sourceId: input.sourceId,
          userId: input.userId,
          quantity: input.quantity,
          status: "fulfilled",
          detail: assigned.detail,
        },
      });
      await tx.prizeStock.update({ where: { id: stock.id }, data: { shopStatus: "fulfilled", updatedAt: input.now } });
      return { result: "fulfilled" as const, status: created.status, detail: created.detail };
    }
    const created = await tx.prizeFulfilment.create({
      data: {
        id: randomUUID(),
        guildId: input.guildId,
        stockId: stock.id,
        source: input.source,
        sourceId: input.sourceId,
        userId: input.userId,
        quantity: input.quantity,
        status: "shop_pending",
        detail: SHOP_KEY_DETAIL,
      },
    });
    await tx.prizeStock.update({ where: { id: stock.id }, data: { shopStatus: "shop_pending", updatedAt: input.now } });
    return { result: "shop_pending" as const, status: created.status, detail: created.detail };
  }
  if (stock.kind === "item") {
    if (stock.onHand < input.quantity) {
      return { result: "insufficient" as const };
    }
    await tx.prizeStock.update({ where: { id: stock.id }, data: { onHand: stock.onHand - input.quantity, updatedAt: input.now } });
    const created = await tx.prizeFulfilment.create({
      data: {
        id: randomUUID(),
        guildId: input.guildId,
        stockId: stock.id,
        source: input.source,
        sourceId: input.sourceId,
        userId: input.userId,
        quantity: input.quantity,
        status: "fulfilled",
        detail: "Private item fulfilment.",
      },
    });
    return { result: "fulfilled" as const, status: created.status, detail: created.detail };
  }
  const amountMarks = stock.marksEach * input.quantity;
  const amount = minor(amountMarks);
  if (!amount) {
    return { result: "invalid" as const };
  }
  const period = perthPeriod(input.now);
  const rows = await tx.$queryRaw<Array<{ authorizedMinor: bigint; spentMinor: bigint }>>`
    SELECT "authorizedMinor", "spentMinor" FROM "issuance_budget"
    WHERE "guildId" = ${input.guildId} AND "scope" = 'exceptional' AND "periodKey" = ${period} AND "subjectId" = 'guild'
    FOR UPDATE
  `;
  const pool = rows[0];
  if (!pool || pool.authorizedMinor - pool.spentMinor < amount) {
    return { result: "unfunded" as const };
  }
  const moved = await walletMove(tx, {
    guildId: input.guildId,
    userId: input.userId,
    availableDelta: amount,
    escrowDelta: 0n,
    kind: "issue",
    direction: "credit",
    amountMinor: amount,
    source: input.source,
    sourceId: input.sourceId,
    idempotencyKey: `prize:${input.source}:${input.sourceId}:${input.userId}`,
    reason: "Stocked Marks prize",
    actorUserId: input.actorUserId,
    now: input.now,
    pace: "exceptional",
  });
  if (moved === "insufficient") {
    return { result: "insufficient" as const };
  }
  if (moved === "ok") {
    await tx.$executeRaw`
      UPDATE "issuance_budget"
      SET "spentMinor" = "spentMinor" + ${amount}, "updatedAt" = NOW()
      WHERE "guildId" = ${input.guildId} AND "scope" = 'exceptional' AND "periodKey" = ${period} AND "subjectId" = 'guild'
    `;
  }
  await tx.prizeStock.update({ where: { id: stock.id }, data: { onHand: Math.max(0, stock.onHand - input.quantity), updatedAt: input.now } });
  const created = await tx.prizeFulfilment.create({
    data: {
      id: randomUUID(),
      guildId: input.guildId,
      stockId: stock.id,
      source: input.source,
      sourceId: input.sourceId,
      userId: input.userId,
      quantity: input.quantity,
      status: "fulfilled",
      detail: "Private Marks fulfilment.",
    },
  });
  return { result: "fulfilled" as const, status: created.status, detail: created.detail };
}

export async function createContest(
  db: Root,
  input: {
    guildId: string;
    title: string;
    mode: "vote" | "judge";
    rules: string;
    category: string;
    allowedTypes: readonly string[];
    mediaLimit?: number;
    closesAt: Date;
    editsBeforeClose?: boolean;
    selfVote?: boolean;
    blind?: boolean;
    privateEntries?: boolean;
    tiePolicy?: "publish" | "staff_break";
    criteria?: readonly { name: string; weight: number }[];
    stockId?: string;
    prizeQuantity?: number;
    requiredRoleId?: string;
    actorUserId: string;
    actorRoleIds: readonly string[];
    now: Date;
  },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const title = text(input.title, 80);
  const rules = text(input.rules, 1000);
  const category = text(input.category, 40);
  const allowed = [...new Set(input.allowedTypes.map((type) => type.trim()))];
  const mediaLimit = input.mediaLimit ?? 1000;
  const tiePolicy = input.tiePolicy ?? "publish";
  const criteria = input.criteria ?? [];
  if (
    !title || !rules || !category || input.mode !== "vote" && input.mode !== "judge" ||
    allowed.length < 1 || allowed.some((type) => !mediaAllowed(type, allowed)) ||
    !Number.isSafeInteger(mediaLimit) || mediaLimit < 1 || mediaLimit > 4000 ||
    input.closesAt.getTime() <= input.now.getTime() ||
    tiePolicy !== "publish" && tiePolicy !== "staff_break" ||
    (input.mode === "judge" && criteria.length < 1) ||
    criteria.some((criterion) => !text(criterion.name, 40) || !Number.isSafeInteger(criterion.weight) || criterion.weight < 1)
  ) {
    return { result: "invalid" as const };
  }
  await ensureGuild(db, { guildId: input.guildId });
  const id = randomUUID();
  await db.contest.create({
    data: {
      id,
      guildId: input.guildId,
      title,
      mode: input.mode,
      rules,
      category,
      allowedTypes: allowed.join(","),
      mediaLimit,
      closesAt: input.closesAt,
      editsBeforeClose: input.editsBeforeClose ?? true,
      selfVote: input.selfVote ?? false,
      blind: input.blind ?? false,
      privateEntries: input.privateEntries ?? false,
      tiePolicy,
      requiredRoleId: input.requiredRoleId?.trim() ?? "",
      status: "draft",
      stockId: input.stockId?.trim() ?? "",
      prizeQuantity: input.prizeQuantity ?? 0,
      updatedAt: input.now,
    },
  });
  if (criteria.length > 0) {
    await db.contestCriterion.createMany({
      data: criteria.map((criterion) => ({ id: randomUUID(), guildId: input.guildId, contestId: id, name: text(criterion.name, 40) ?? criterion.name, weight: criterion.weight })),
    });
  }
  await enqueueJob(db, { guildId: input.guildId, jobType: "contest.close", payload: { contestId: id }, idempotencyKey: `contest-close:${id}`, runAt: input.closesAt });
  await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "contest.create", targetType: "contest", targetId: id, reason: "Create contest" });
  return { result: "draft" as const, contest: { id } };
}

export async function publishContest(
  db: Root,
  input: { guildId: string; contestId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const contest = await db.contest.findUnique({ where: { id: input.contestId } });
  if (!contest || contest.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  if (contest.publishedAt) {
    return { result: "already_published" as const };
  }
  await db.contest.update({ where: { id: contest.id }, data: { status: "open", publishedAt: input.now, updatedAt: input.now } });
  await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "contest.publish", targetType: "contest", targetId: contest.id, reason: "Publish contest rules" });
  return { result: "published" as const };
}

async function contestOpen(tx: Tx, contestId: string, guildId: string, now: Date) {
  await tx.$queryRaw`SELECT "id" FROM "contest" WHERE "id" = ${contestId} FOR UPDATE`;
  const contest = await tx.contest.findUnique({ where: { id: contestId } });
  if (!contest || contest.guildId !== guildId) {
    return { contest: null, state: "missing" as const };
  }
  if (contest.status === "draft" || !contest.publishedAt) {
    return { contest, state: "unpublished" as const };
  }
  if (contest.status !== "open" || now >= contest.closesAt) {
    if (contest.status === "open" && now >= contest.closesAt) {
      await closeContestRow(tx, contest.id, now, false, "system");
    }
    return { contest, state: "closed" as const };
  }
  return { contest, state: "open" as const };
}

export async function submitContestEntry(
  db: Root,
  input: { guildId: string; contestId: string; userId: string; title: string; mediaType: string; body: string; roleIds: readonly string[]; now: Date },
) {
  if ((await opened(db, input.guildId)) !== "ok") {
    return { result: "maintenance" as const };
  }
  const title = text(input.title, 80);
  const body = input.body.trim();
  if (!title) {
    return { result: "invalid" as const };
  }
  return db.$transaction(async (tx) => {
    const gate = await contestOpen(tx, input.contestId, input.guildId, input.now);
    if (!gate.contest || gate.state !== "open") {
      return { result: gate.state };
    }
    if (gate.contest.requiredRoleId && !input.roleIds.includes(gate.contest.requiredRoleId)) {
      return { result: "role" as const };
    }
    const allowed = gate.contest.allowedTypes.split(",");
    if (!mediaAllowed(input.mediaType, allowed) || body.length > gate.contest.mediaLimit) {
      return { result: "invalid" as const };
    }
    const existing = await tx.contestEntry.findUnique({ where: { contestId_userId: { contestId: gate.contest.id, userId: input.userId } } });
    if (existing) {
      return { result: "already_submitted" as const, entryId: existing.id };
    }
    const entry = await tx.contestEntry.create({
      data: {
        id: randomUUID(),
        guildId: input.guildId,
        contestId: gate.contest.id,
        userId: input.userId,
        title,
        mediaType: input.mediaType,
        body,
        status: "submitted",
        revision: 1,
        updatedAt: input.now,
      },
    });
    return { result: "submitted" as const, entryId: entry.id };
  });
}

export async function editContestEntry(
  db: Root,
  input: { guildId: string; contestId: string; userId: string; title: string; body: string; now: Date },
) {
  if ((await opened(db, input.guildId)) !== "ok") {
    return { result: "maintenance" as const };
  }
  const title = text(input.title, 80);
  if (!title || input.body.trim().length < 1) {
    return { result: "invalid" as const };
  }
  return db.$transaction(async (tx) => {
    const gate = await contestOpen(tx, input.contestId, input.guildId, input.now);
    if (!gate.contest || gate.state !== "open") {
      return { result: gate.state };
    }
    if (!gate.contest.editsBeforeClose) {
      return { result: "closed" as const };
    }
    const entry = await tx.contestEntry.findUnique({ where: { contestId_userId: { contestId: gate.contest.id, userId: input.userId } } });
    if (!entry || entry.status !== "submitted") {
      return { result: "missing" as const };
    }
    if (input.body.trim().length > gate.contest.mediaLimit) {
      return { result: "invalid" as const };
    }
    await tx.contestEntry.update({ where: { id: entry.id }, data: { title, body: input.body.trim(), revision: entry.revision + 1, updatedAt: input.now } });
    return { result: "updated" as const, revision: entry.revision + 1 };
  });
}

export async function castContestBallot(
  db: Root,
  input: { guildId: string; contestId: string; entryId: string; voterUserId: string; roleIds: readonly string[]; scores?: Record<string, number>; now: Date },
) {
  if ((await opened(db, input.guildId)) !== "ok") {
    return { result: "maintenance" as const };
  }
  return db.$transaction(async (tx) => {
    const gate = await contestOpen(tx, input.contestId, input.guildId, input.now);
    if (!gate.contest || gate.state !== "open") {
      return { result: gate.state };
    }
    if (gate.contest.requiredRoleId && !input.roleIds.includes(gate.contest.requiredRoleId)) {
      return { result: "role" as const };
    }
    const entry = await tx.contestEntry.findUnique({ where: { id: input.entryId } });
    if (!entry || entry.contestId !== gate.contest.id || entry.status !== "submitted") {
      return { result: "missing" as const };
    }
    if (!gate.contest.selfVote && entry.userId === input.voterUserId) {
      return { result: "self_vote" as const };
    }
    if (gate.contest.mode === "judge") {
      if ((await actorCan(tx, { guildId: input.guildId, roleIds: input.roleIds, capability: "event_management" })) !== "allowed") {
        return { result: "denied" as const };
      }
      const criteria = await tx.contestCriterion.findMany({ where: { contestId: gate.contest.id } });
      if (weightedScore(criteria, input.scores ?? {}) === null) {
        return { result: "invalid" as const };
      }
      const existing = await tx.contestBallot.findUnique({
        where: { contestId_voterUserId_entryId: { contestId: gate.contest.id, voterUserId: input.voterUserId, entryId: entry.id } },
      });
      if (existing) {
        await tx.contestBallot.update({ where: { id: existing.id }, data: { scores: input.scores ?? {}, updatedAt: input.now } });
      } else {
        await tx.contestBallot.create({
          data: {
            id: randomUUID(),
            guildId: input.guildId,
            contestId: gate.contest.id,
            entryId: entry.id,
            voterUserId: input.voterUserId,
            scores: input.scores ?? {},
            updatedAt: input.now,
          },
        });
      }
      return { result: "recorded" as const, authorVisible: gate.contest.blind ? "" : entry.userId };
    }
    const prior = await tx.contestBallot.findMany({ where: { contestId: gate.contest.id, voterUserId: input.voterUserId } });
    if (prior.length === 1 && prior[0]?.entryId === entry.id) {
      return { result: "already_recorded" as const };
    }
    if (prior.length > 0) {
      await tx.contestBallot.deleteMany({ where: { contestId: gate.contest.id, voterUserId: input.voterUserId } });
    }
    await tx.contestBallot.create({
      data: {
        id: randomUUID(),
        guildId: input.guildId,
        contestId: gate.contest.id,
        entryId: entry.id,
        voterUserId: input.voterUserId,
        scores: {},
        updatedAt: input.now,
      },
    });
    return { result: "recorded" as const };
  });
}

async function writeResults(tx: Tx, contestId: string, guildId: string) {
  const contest = await tx.contest.findUnique({ where: { id: contestId } });
  if (!contest) {
    return;
  }
  const entries = await tx.contestEntry.findMany({ where: { contestId, status: "submitted" } });
  const ballots = await tx.contestBallot.findMany({ where: { contestId } });
  const criteria = await tx.contestCriterion.findMany({ where: { contestId } });
  const rows = entries.map((entry) => {
    if (contest.mode === "vote") {
      return { entryId: entry.id, score: ballots.filter((ballot) => ballot.entryId === entry.id).length };
    }
    const score = ballots
      .filter((ballot) => ballot.entryId === entry.id)
      .reduce((sum, ballot) => sum + (weightedScore(criteria, scoreMap(ballot.scores)) ?? 0), 0);
    return { entryId: entry.id, score };
  });
  const leaders = tiedLeaders(rows);
  const tied = leaders.length > 1;
  await tx.contestResult.deleteMany({ where: { contestId } });
  if (rows.length > 0) {
    await tx.contestResult.createMany({
      data: rows.map((row) => ({
        id: randomUUID(),
        guildId,
        contestId,
        entryId: row.entryId,
        score: row.score,
        tied: tied && leaders.some((leader) => leader.entryId === row.entryId),
      })),
    });
  }
}

async function closeContestRow(tx: Tx, contestId: string, now: Date, force: boolean, actorUserId: string) {
  const contest = await tx.contest.findUnique({ where: { id: contestId } });
  if (!contest) {
    return { result: "missing" as const };
  }
  if (contest.status === "closed" || contest.status === "awarded" || contest.status === "cancelled") {
    return { result: "already_closed" as const };
  }
  if (!force && now < contest.closesAt) {
    return { result: "open" as const };
  }
  await writeResults(tx, contest.id, contest.guildId);
  await tx.contest.update({ where: { id: contest.id }, data: { status: "closed", archivedAt: now, updatedAt: now } });
  await writeAudit(tx, { guildId: contest.guildId, actorUserId, action: "contest.close", targetType: "contest", targetId: contest.id, reason: "Close contest" });
  const results = await tx.contestResult.findMany({ where: { contestId: contest.id } });
  const leaders = results.filter((result) => result.tied);
  return { result: leaders.length > 1 ? "tie_published" as const : "closed" as const };
}

export async function closeDueContest(db: Root, contestId: string, now: Date) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "contest" WHERE "id" = ${contestId} FOR UPDATE`;
    return closeContestRow(tx, contestId, now, false, "system");
  });
}

export async function closeContest(
  db: Root,
  input: { guildId: string; contestId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "contest" WHERE "id" = ${input.contestId} FOR UPDATE`;
    const contest = await tx.contest.findUnique({ where: { id: input.contestId } });
    if (!contest || contest.guildId !== input.guildId) {
      return { result: "missing" as const };
    }
    return closeContestRow(tx, contest.id, input.now, true, input.actorUserId);
  });
}

export async function correctContest(
  db: Root,
  input: { guildId: string; contestId: string; entryId: string; reason: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const reason = text(input.reason, 500);
  if (!reason) {
    return { result: "invalid" as const };
  }
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "contest" WHERE "id" = ${input.contestId} FOR UPDATE`;
    const contest = await tx.contest.findUnique({ where: { id: input.contestId } });
    const entry = await tx.contestEntry.findUnique({ where: { id: input.entryId } });
    if (!contest || contest.guildId !== input.guildId || !entry || entry.contestId !== contest.id) {
      return { result: "missing" as const };
    }
    if (contest.status !== "closed" && contest.status !== "awarded") {
      return { result: "open" as const };
    }
    await tx.contestEntry.update({ where: { id: entry.id }, data: { status: "disqualified", updatedAt: input.now } });
    await writeResults(tx, contest.id, contest.guildId);
    await writeAudit(tx, { guildId: input.guildId, actorUserId: input.actorUserId, action: "contest.correct", targetType: "contest_entry", targetId: entry.id, reason });
    return { result: "corrected" as const };
  });
}

export async function awardContest(
  db: Root,
  input: { guildId: string; contestId: string; winnerEntryId?: string; reason: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const reason = text(input.reason, 500);
  if (!reason) {
    return { result: "invalid" as const };
  }
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "contest" WHERE "id" = ${input.contestId} FOR UPDATE`;
    const contest = await tx.contest.findUnique({ where: { id: input.contestId } });
    if (!contest || contest.guildId !== input.guildId) {
      return { result: "missing" as const };
    }
    if (contest.status === "awarded") {
      return { result: "already_recorded" as const };
    }
    if (contest.status !== "closed") {
      return { result: "open" as const };
    }
    const results = await tx.contestResult.findMany({ where: { contestId: contest.id } });
    const top = results.reduce((best, row) => Math.max(best, row.score), 0);
    const leaders = results.filter((row) => row.score === top && row.score > 0);
    if (leaders.length === 0) {
      return { result: "no_winner" as const };
    }
    if (leaders.length > 1 && contest.tiePolicy === "publish") {
      return { result: "tie_published" as const, leaders: leaders.map((leader) => leader.entryId) };
    }
    const winnerId = leaders.length === 1 ? leaders[0]?.entryId ?? "" : input.winnerEntryId ?? "";
    if (!leaders.some((leader) => leader.entryId === winnerId)) {
      return { result: "tie_published" as const, leaders: leaders.map((leader) => leader.entryId) };
    }
    const entry = await tx.contestEntry.findUnique({ where: { id: winnerId } });
    if (!entry) {
      return { result: "missing" as const };
    }
    let fulfilment = "none";
    if (contest.prizeQuantity > 0) {
      if (!contest.stockId) {
        return { result: "invalid" as const };
      }
      const paid = await fulfilStock(tx, {
        guildId: input.guildId,
        stockId: contest.stockId,
        source: "contest.prize",
        sourceId: contest.id,
        userId: entry.userId,
        quantity: contest.prizeQuantity,
        actorUserId: input.actorUserId,
        now: input.now,
      });
      if (paid.result !== "fulfilled" && paid.result !== "shop_pending" && paid.result !== "already_recorded") {
        return { result: paid.result };
      }
      fulfilment = paid.result === "already_recorded" ? paid.status : paid.result;
    }
    await tx.contest.update({ where: { id: contest.id }, data: { status: "awarded", updatedAt: input.now } });
    await writeAudit(tx, { guildId: input.guildId, actorUserId: input.actorUserId, action: "contest.award", targetType: "contest", targetId: contest.id, reason });
    return { result: "awarded" as const, fulfilment, winnerUserId: entry.userId };
  });
}

export async function readContest(db: Writer, input: { guildId: string; contestId: string; audience: "member" | "staff"; actorRoleIds?: readonly string[] }) {
  if (input.audience === "staff") {
    const gated = await staff(db, { guildId: input.guildId, actorRoleIds: input.actorRoleIds ?? [] });
    if (gated !== "ok") {
      return { result: gated };
    }
  } else if ((await opened(db, input.guildId)) !== "ok") {
    return { result: "maintenance" as const };
  }
  const contest = await db.contest.findUnique({ where: { id: input.contestId } });
  if (!contest || contest.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  const entries = await db.contestEntry.findMany({ where: { contestId: contest.id }, orderBy: { createdAt: "asc" } });
  const results = await db.contestResult.findMany({ where: { contestId: contest.id } });
  const hideAuthor = contest.blind && contest.status === "open" && input.audience === "member";
  const hideBody = contest.privateEntries && input.audience === "member";
  return {
    result: "ok" as const,
    contest: { id: contest.id, title: contest.title, rules: contest.rules, status: contest.status, mode: contest.mode, tiePolicy: contest.tiePolicy },
    entries: entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      userId: hideAuthor ? "" : entry.userId,
      body: hideBody ? "" : entry.body,
      status: entry.status,
      revision: entry.revision,
    })),
    results: results.map((result) => ({ entryId: result.entryId, score: result.score, tied: result.tied })),
  };
}

async function eligibleGiveaway(tx: Tx, giveaway: { requiredRoleId: string; minAccountDays: number; attendanceOccurrenceId: string }, input: { userId: string; roleIds: readonly string[]; accountAgeDays: number }) {
  const attendance = giveaway.attendanceOccurrenceId
    ? (await tx.eventRsvp.findUnique({ where: { occurrenceId_userId: { occurrenceId: giveaway.attendanceOccurrenceId, userId: input.userId } } }))?.attended === true
    : true;
  return entryEligibility({
    requiredRoleId: giveaway.requiredRoleId,
    roleIds: input.roleIds,
    minAccountDays: giveaway.minAccountDays,
    accountAgeDays: input.accountAgeDays,
    attendanceRequired: giveaway.attendanceOccurrenceId.length > 0,
    attended: attendance,
  });
}

async function sealGiveaway(tx: Tx, giveawayId: string, now: Date, force: boolean) {
  const giveaway = await tx.giveaway.findUnique({ where: { id: giveawayId } });
  if (!giveaway) {
    return null;
  }
  if (giveaway.status === "cancelled" || giveaway.snapshot) {
    return giveaway;
  }
  if (!force && now < giveaway.closesAt && giveaway.status === "open") {
    return giveaway;
  }
  if (giveaway.status !== "open" && !giveaway.snapshot) {
    return giveaway;
  }
  const entries = await tx.giveawayEntry.findMany({ where: { giveawayId: giveaway.id } });
  const snapshot = {
    tickets: [...entries]
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((entry) => ({ entryId: entry.id, userId: entry.userId, kind: entry.kind })),
  };
  return tx.giveaway.update({ where: { id: giveaway.id }, data: { snapshot, status: "closed", closedAt: now, updatedAt: now } });
}

export async function createGiveaway(
  db: Root,
  input: {
    guildId: string;
    title: string;
    rules: string;
    bonusRules: string;
    closesAt: Date;
    claimMinutes?: number;
    maxBonus: number;
    winnerCount?: number;
    stockId?: string;
    prizeQuantity?: number;
    sponsor?: string;
    requiredRoleId?: string;
    minAccountDays?: number;
    attendanceOccurrenceId?: string;
    actorUserId: string;
    actorRoleIds: readonly string[];
    now: Date;
  },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const title = text(input.title, 80);
  const rules = text(input.rules, 1000);
  const bonusRules = text(input.bonusRules, 1000);
  const claimMinutes = input.claimMinutes ?? 60;
  const winnerCount = input.winnerCount ?? 1;
  const prizeQuantity = input.prizeQuantity ?? 1;
  if (
    !title || !rules || !bonusRules || input.closesAt.getTime() <= input.now.getTime() ||
    !Number.isSafeInteger(input.maxBonus) || input.maxBonus < 0 || input.maxBonus > 20 ||
    !Number.isSafeInteger(claimMinutes) || claimMinutes < 1 || claimMinutes > 10_080 ||
    !Number.isSafeInteger(winnerCount) || winnerCount < 1 || winnerCount > 20 ||
    !Number.isSafeInteger(prizeQuantity) || prizeQuantity < 1
  ) {
    return { result: "invalid" as const };
  }
  await ensureGuild(db, { guildId: input.guildId });
  const id = randomUUID();
  await db.giveaway.create({
    data: {
      id,
      guildId: input.guildId,
      title,
      rules,
      bonusRules,
      closesAt: input.closesAt,
      claimMinutes,
      maxBonus: input.maxBonus,
      winnerCount,
      status: "open",
      stockId: input.stockId?.trim() ?? "",
      prizeQuantity,
      sponsor: input.sponsor?.trim() ?? "",
      requiredRoleId: input.requiredRoleId?.trim() ?? "",
      minAccountDays: input.minAccountDays ?? 0,
      attendanceOccurrenceId: input.attendanceOccurrenceId?.trim() ?? "",
      updatedAt: input.now,
    },
  });
  await enqueueJob(db, { guildId: input.guildId, jobType: "giveaway.close", payload: { giveawayId: id }, idempotencyKey: `giveaway-close:${id}`, runAt: input.closesAt });
  await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "giveaway.create", targetType: "giveaway", targetId: id, reason: "Open giveaway" });
  return { result: "open" as const, giveaway: { id } };
}

export async function enterGiveaway(
  db: Root,
  input: { guildId: string; giveawayId: string; userId: string; roleIds: readonly string[]; accountAgeDays: number; now: Date },
) {
  if ((await opened(db, input.guildId)) !== "ok") {
    return { result: "maintenance" as const };
  }
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "giveaway" WHERE "id" = ${input.giveawayId} FOR UPDATE`;
      const giveaway = await tx.giveaway.findUnique({ where: { id: input.giveawayId } });
      if (!giveaway || giveaway.guildId !== input.guildId) {
        return { result: "missing" as const };
      }
      if (giveaway.status === "cancelled") {
        return { result: "cancelled" as const };
      }
      if (giveaway.status !== "open" || input.now >= giveaway.closesAt || giveaway.snapshot) {
        await sealGiveaway(tx, giveaway.id, input.now, input.now >= giveaway.closesAt);
        return { result: "closed" as const };
      }
      const eligible = await eligibleGiveaway(tx, giveaway, input);
      if (eligible !== "allowed") {
        return { result: eligible };
      }
      const existing = await tx.giveawayEntry.findFirst({ where: { giveawayId: giveaway.id, userId: input.userId, kind: "free" } });
      if (existing) {
        return { result: "already_entered" as const };
      }
      await tx.giveawayEntry.create({
        data: { id: randomUUID(), guildId: input.guildId, giveawayId: giveaway.id, userId: input.userId, kind: "free", activityKey: "" },
      });
      return { result: "entered" as const };
    });
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    return { result: "already_entered" as const };
  }
}

export async function addGiveawayBonus(
  db: Root,
  input: { guildId: string; giveawayId: string; userId: string; activityKey: string; roleIds: readonly string[]; accountAgeDays: number; now: Date },
) {
  if ((await opened(db, input.guildId)) !== "ok") {
    return { result: "maintenance" as const };
  }
  const activityKey = text(input.activityKey, 80);
  if (!activityKey) {
    return { result: "invalid" as const };
  }
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "giveaway" WHERE "id" = ${input.giveawayId} FOR UPDATE`;
      const giveaway = await tx.giveaway.findUnique({ where: { id: input.giveawayId } });
      if (!giveaway || giveaway.guildId !== input.guildId) {
        return { result: "missing" as const };
      }
      if (giveaway.status !== "open" || input.now >= giveaway.closesAt || giveaway.snapshot) {
        await sealGiveaway(tx, giveaway.id, input.now, input.now >= giveaway.closesAt);
        return { result: "closed" as const };
      }
      const eligible = await eligibleGiveaway(tx, giveaway, input);
      if (eligible !== "allowed") {
        return { result: eligible };
      }
      const duplicate = await tx.giveawayEntry.findFirst({ where: { giveawayId: giveaway.id, kind: "bonus", activityKey } });
      if (duplicate) {
        return { result: "already_recorded" as const };
      }
      const existing = await tx.giveawayEntry.count({ where: { giveawayId: giveaway.id, userId: input.userId, kind: "bonus" } });
      if (bonusDecision(existing, giveaway.maxBonus) === "capped") {
        return { result: "capped" as const };
      }
      await tx.giveawayEntry.create({
        data: { id: randomUUID(), guildId: input.guildId, giveawayId: giveaway.id, userId: input.userId, kind: "bonus", activityKey },
      });
      return { result: "recorded" as const };
    });
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    return { result: "already_recorded" as const };
  }
}

export async function closeDueGiveaway(db: Root, giveawayId: string, now: Date, force = false) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "giveaway" WHERE "id" = ${giveawayId} FOR UPDATE`;
    const current = await tx.giveaway.findUnique({ where: { id: giveawayId } });
    if (!current) {
      return { result: "missing" as const };
    }
    if (current.snapshot) {
      return { result: "already_closed" as const };
    }
    if (current.status === "cancelled") {
      return { result: "cancelled" as const };
    }
    if (!force && now < current.closesAt) {
      return { result: "open" as const };
    }
    const sealed = await sealGiveaway(tx, giveawayId, now, true);
    return { result: sealed?.snapshot ? "closed" as const : "open" as const };
  });
}

export async function closeGiveaway(
  db: Root,
  input: { guildId: string; giveawayId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const closed = await closeDueGiveaway(db, input.giveawayId, input.now, true);
  if (closed.result === "closed") {
    await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "giveaway.close", targetType: "giveaway", targetId: input.giveawayId, reason: "Lock giveaway snapshot" });
  }
  return closed;
}

export async function drawGiveaway(
  db: Root,
  input: { guildId: string; giveawayId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date; randomIndex?: (max: number) => number },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const randomIndex = input.randomIndex ?? secureIndex;
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "giveaway" WHERE "id" = ${input.giveawayId} FOR UPDATE`;
    const giveaway = await tx.giveaway.findUnique({ where: { id: input.giveawayId } });
    if (!giveaway || giveaway.guildId !== input.guildId) {
      return { result: "missing" as const };
    }
    if (giveaway.status === "cancelled") {
      return { result: "cancelled" as const };
    }
    if (giveaway.status === "drawn") {
      return { result: "already_drawn" as const };
    }
    if (!giveaway.snapshot && input.now < giveaway.closesAt) {
      return { result: "open" as const };
    }
    const sealed = giveaway.snapshot ? giveaway : await sealGiveaway(tx, giveaway.id, input.now, true);
    const tickets = ticketsFrom(sealed?.snapshot);
    if (tickets.length === 0) {
      return { result: "no_entries" as const };
    }
    const winners = drawWinners(tickets, giveaway.winnerCount, new Set(), randomIndex);
    if (winners.length === 0) {
      return { result: "no_entries" as const };
    }
    const claimBy = new Date(input.now.getTime() + giveaway.claimMinutes * 60_000);
    const draws = [];
    for (const [index, userId] of winners.entries()) {
      const draw = await tx.giveawayDraw.create({
        data: {
          id: randomUUID(),
          guildId: input.guildId,
          giveawayId: giveaway.id,
          sequence: index + 1,
          userId,
          status: "pending_claim",
          claimBy,
          fulfilment: "pending",
          actorUserId: input.actorUserId,
          delivery: "setup_required",
        },
      });
      draws.push({ id: draw.id, sequence: draw.sequence, userId: draw.userId });
      await enqueueJob(tx, {
        guildId: input.guildId,
        jobType: "giveaway.claim",
        payload: { drawId: draw.id },
        idempotencyKey: `giveaway-claim:${draw.id}`,
        runAt: claimBy,
      });
    }
    await tx.giveaway.update({ where: { id: giveaway.id }, data: { status: "drawn", updatedAt: input.now } });
    await writeAudit(tx, { guildId: input.guildId, actorUserId: input.actorUserId, action: "giveaway.draw", targetType: "giveaway", targetId: giveaway.id, reason: "Draw from the locked snapshot" });
    return { result: "drawn" as const, draws, delivery: "setup_required" as const };
  });
}

export async function claimGiveaway(
  db: Root,
  input: { guildId: string; drawId: string; userId: string; now: Date },
) {
  if ((await opened(db, input.guildId)) !== "ok") {
    return { result: "maintenance" as const };
  }
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "giveaway_draw" WHERE "id" = ${input.drawId} FOR UPDATE`;
    const draw = await tx.giveawayDraw.findUnique({ where: { id: input.drawId } });
    if (!draw || draw.guildId !== input.guildId) {
      return { result: "missing" as const };
    }
    if (draw.userId !== input.userId) {
      return { result: "not_winner" as const };
    }
    if (draw.status === "claimed") {
      return { result: "already_claimed" as const, fulfilment: draw.fulfilment };
    }
    if (draw.status !== "pending_claim" || input.now >= draw.claimBy) {
      return { result: "expired" as const };
    }
    const giveaway = await tx.giveaway.findUnique({ where: { id: draw.giveawayId } });
    if (!giveaway) {
      return { result: "missing" as const };
    }
    let fulfilment = "none";
    let detail = "Private fulfilment.";
    if (giveaway.stockId) {
      const paid = await fulfilStock(tx, {
        guildId: input.guildId,
        stockId: giveaway.stockId,
        source: "giveaway.prize",
        sourceId: giveaway.id,
        userId: draw.userId,
        quantity: giveaway.prizeQuantity,
        actorUserId: draw.userId,
        now: input.now,
      });
      if (paid.result !== "fulfilled" && paid.result !== "shop_pending" && paid.result !== "already_recorded") {
        return { result: paid.result };
      }
      fulfilment = paid.status;
      detail = paid.detail;
    }
    await tx.giveawayDraw.update({ where: { id: draw.id }, data: { status: "claimed", fulfilment, detail } });
    return { result: "claimed" as const, fulfilment, detail, delivery: "setup_required" as const };
  });
}

export async function disqualifyGiveaway(
  db: Root,
  input: { guildId: string; drawId: string; reason: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const reason = text(input.reason, 500);
  if (!reason) {
    return { result: "invalid" as const };
  }
  const draw = await db.giveawayDraw.findUnique({ where: { id: input.drawId } });
  if (!draw || draw.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  if (draw.status === "disqualified") {
    return { result: "already_recorded" as const };
  }
  if (draw.status !== "pending_claim" && draw.status !== "expired") {
    return { result: "claimed" as const };
  }
  await db.giveawayDraw.update({ where: { id: draw.id }, data: { status: "disqualified", reason } });
  await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "giveaway.disqualify", targetType: "giveaway_draw", targetId: draw.id, reason });
  return { result: "disqualified" as const };
}

export async function rerollGiveaway(
  db: Root,
  input: { guildId: string; giveawayId: string; reason: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date; randomIndex?: (max: number) => number },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const reason = text(input.reason, 500);
  if (!reason) {
    return { result: "invalid" as const };
  }
  const randomIndex = input.randomIndex ?? secureIndex;
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "giveaway" WHERE "id" = ${input.giveawayId} FOR UPDATE`;
    const giveaway = await tx.giveaway.findUnique({ where: { id: input.giveawayId } });
    if (!giveaway || giveaway.guildId !== input.guildId || !giveaway.snapshot) {
      return { result: "missing" as const };
    }
    const draws = await tx.giveawayDraw.findMany({ where: { giveawayId: giveaway.id }, orderBy: { sequence: "asc" } });
    if (!draws.some((draw) => draw.status === "disqualified" || draw.status === "expired")) {
      return { result: "not_eligible" as const };
    }
    const excluded = new Set(draws.map((draw) => draw.userId));
    const next = drawWinners(ticketsFrom(giveaway.snapshot), 1, excluded, randomIndex);
    const userId = next[0];
    if (!userId) {
      return { result: "no_entries" as const };
    }
    const sequence = draws.reduce((best, draw) => Math.max(best, draw.sequence), 0) + 1;
    const claimBy = new Date(input.now.getTime() + giveaway.claimMinutes * 60_000);
    const draw = await tx.giveawayDraw.create({
      data: {
        id: randomUUID(),
        guildId: input.guildId,
        giveawayId: giveaway.id,
        sequence,
        userId,
        status: "pending_claim",
        claimBy,
        fulfilment: "pending",
        reason,
        actorUserId: input.actorUserId,
        delivery: "setup_required",
      },
    });
    await enqueueJob(tx, { guildId: input.guildId, jobType: "giveaway.claim", payload: { drawId: draw.id }, idempotencyKey: `giveaway-claim:${draw.id}`, runAt: claimBy });
    await writeAudit(tx, { guildId: input.guildId, actorUserId: input.actorUserId, action: "giveaway.reroll", targetType: "giveaway", targetId: giveaway.id, reason });
    return { result: "rerolled" as const, draw: { id: draw.id, sequence: draw.sequence, userId: draw.userId }, initialPreserved: draws.some((row) => row.sequence === 1) };
  });
}

export async function cancelGiveaway(
  db: Root,
  input: { guildId: string; giveawayId: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date },
) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "giveaway" WHERE "id" = ${input.giveawayId} FOR UPDATE`;
    const giveaway = await tx.giveaway.findUnique({ where: { id: input.giveawayId } });
    if (!giveaway || giveaway.guildId !== input.guildId) {
      return { result: "missing" as const };
    }
    if (giveaway.status === "cancelled") {
      return { result: "already_cancelled" as const };
    }
    if (giveaway.status === "drawn" || giveaway.snapshot) {
      return { result: "drawn" as const };
    }
    await tx.giveaway.update({ where: { id: giveaway.id }, data: { status: "cancelled", updatedAt: input.now } });
    await writeAudit(tx, { guildId: input.guildId, actorUserId: input.actorUserId, action: "giveaway.cancel", targetType: "giveaway", targetId: giveaway.id, reason: "Cancel giveaway" });
    return { result: "cancelled" as const };
  });
}

export async function expireGiveawayClaim(db: Root, drawId: string, now: Date) {
  const draw = await db.giveawayDraw.findUnique({ where: { id: drawId } });
  if (!draw || draw.status !== "pending_claim" || now < draw.claimBy) {
    return { result: draw ? "open" as const : "missing" as const };
  }
  await db.giveawayDraw.update({ where: { id: draw.id }, data: { status: "expired" } });
  return { result: "expired" as const };
}

export async function sweepActivities(db: Root, now: Date) {
  const predictions = await db.prediction.findMany({ where: { status: "open", lockAt: { lte: now } }, take: 20 });
  for (const prediction of predictions) {
    await lockDuePrediction(db, prediction.id, now);
  }
  const contests = await db.contest.findMany({ where: { status: "open", closesAt: { lte: now } }, take: 20 });
  for (const contest of contests) {
    await closeDueContest(db, contest.id, now);
  }
  const giveaways = await db.giveaway.findMany({ where: { status: "open", closesAt: { lte: now } }, take: 20 });
  for (const giveaway of giveaways) {
    await closeDueGiveaway(db, giveaway.id, now);
  }
  const draws = await db.giveawayDraw.findMany({ where: { status: "pending_claim", claimBy: { lte: now } }, take: 20 });
  for (const draw of draws) {
    await expireGiveawayClaim(db, draw.id, now);
  }
}

export async function readActivities(db: Writer, input: { guildId: string; actorRoleIds: readonly string[] }) {
  const gated = await staff(db, input);
  if (gated !== "ok") {
    return { result: gated };
  }
  const [predictions, contests, giveaways, stock, fulfilments] = await Promise.all([
    db.prediction.findMany({ where: { guildId: input.guildId }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.contest.findMany({ where: { guildId: input.guildId }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.giveaway.findMany({ where: { guildId: input.guildId }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.prizeStock.findMany({ where: { guildId: input.guildId }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.prizeFulfilment.findMany({ where: { guildId: input.guildId }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const draws = await db.giveawayDraw.findMany({ where: { guildId: input.guildId }, orderBy: { createdAt: "desc" }, take: 30 });
  return {
    result: "ok" as const,
    predictions: predictions.map((row) => ({ id: row.id, title: row.title, mode: row.mode, status: row.status, resolutionRule: row.resolutionRule, houseFeeBps: row.houseFeeBps })),
    contests: contests.map((row) => ({ id: row.id, title: row.title, mode: row.mode, status: row.status, tiePolicy: row.tiePolicy })),
    giveaways: giveaways.map((row) => ({ id: row.id, title: row.title, status: row.status, sponsor: row.sponsor, snapshotLocked: row.snapshot !== null })),
    draws: draws.map((row) => ({ id: row.id, giveawayId: row.giveawayId, sequence: row.sequence, userId: row.userId, status: row.status, fulfilment: row.fulfilment, detail: row.detail, delivery: row.delivery })),
    stock: stock.map((row) => ({ id: row.id, name: row.name, kind: row.kind, onHand: row.onHand, shopStatus: row.shopStatus })),
    fulfilments: fulfilments.map((row) => ({ id: row.id, source: row.source, userId: row.userId, status: row.status, detail: row.detail })),
  };
}
