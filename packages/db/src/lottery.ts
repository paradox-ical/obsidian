import { randomInt, randomUUID } from "node:crypto";

import {
  LOTTERY_CAP,
  LOTTERY_RULES,
  LOTTERY_STALL_DAYS,
  LOTTERY_TICKET_MARKS,
  entrantsMet,
  formatMinor,
  lotteryBonusMinor,
  lotteryCapDecision,
  lotteryClockDecision,
  lotteryOdds,
  lotteryPriceDecision,
  lotteryStallDecision,
  marksToMinor,
  nextPerthClock,
} from "@collective/domain";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

import { moveHeldCurrency } from "./ledger.js";
import { actorCan, enqueueJob, ensureGuild, moduleIsAvailable, writeAudit, type Writer } from "./platform.js";

type Tx = Prisma.TransactionClient;
type Root = PrismaClient;

class Halt extends Error {
  constructor(readonly outcome: "unfunded" | "insufficient" | "limit" | "closed" | "stalled" | "schedule_required" | "expired" | "stale" | "missing" | "invalid") {
    super(outcome);
  }
}

interface SnapshotTicket {
  ticketId: string;
  userId: string;
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function money(minor: bigint): string {
  return formatMinor(minor);
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function openEconomy(db: Writer, guildId: string) {
  await ensureGuild(db, { guildId });
  return moduleIsAvailable(db, guildId, "economy");
}

async function ensureSettings(tx: Tx, guildId: string) {
  await tx.$executeRaw`
    INSERT INTO "lottery_settings" ("guildId", "ticketMarks", "cap", "stallDays", "hour", "minute", "version", "updatedAt")
    VALUES (${guildId}, ${LOTTERY_TICKET_MARKS}, ${LOTTERY_CAP}, ${LOTTERY_STALL_DAYS}, NULL, NULL, 1, NOW())
    ON CONFLICT ("guildId") DO NOTHING
  `;
  const settings = await tx.lotterySettings.findUnique({ where: { guildId } });
  if (!settings) {
    throw new Halt("missing");
  }
  return settings;
}

async function ensureBudget(tx: Tx, guildId: string) {
  await tx.$executeRaw`
    INSERT INTO "lottery_budget" ("guildId", "authorizedMinor", "reservedMinor", "spentMinor", "updatedAt")
    VALUES (${guildId}, 0, 0, 0, NOW())
    ON CONFLICT ("guildId") DO NOTHING
  `;
  const rows = await tx.$queryRaw<Array<{ authorizedMinor: bigint | string; reservedMinor: bigint | string; spentMinor: bigint | string }>>`
    SELECT "authorizedMinor", "reservedMinor", "spentMinor" FROM "lottery_budget" WHERE "guildId" = ${guildId} FOR UPDATE
  `;
  const budget = rows[0];
  if (!budget) {
    throw new Halt("missing");
  }
  return {
    authorizedMinor: BigInt(budget.authorizedMinor),
    reservedMinor: BigInt(budget.reservedMinor),
    spentMinor: BigInt(budget.spentMinor),
  };
}

function remaining(budget: { authorizedMinor: bigint; reservedMinor: bigint; spentMinor: bigint }) {
  return budget.authorizedMinor - budget.reservedMinor - budget.spentMinor;
}

async function ensureOpenDraw(tx: Tx, guildId: string, now: Date) {
  const settings = await ensureSettings(tx, guildId);
  const existing = await tx.lotteryDraw.findFirst({ where: { guildId, status: "open" } });
  if (existing) {
    return { settings, draw: existing };
  }
  if (settings.hour === null || settings.minute === null) {
    return { settings, draw: null };
  }
  const closesAt = nextPerthClock(now, settings.hour, settings.minute);
  const stallAt = new Date(now.getTime() + settings.stallDays * 86_400_000);
  const id = randomUUID();
  try {
    const draw = await tx.lotteryDraw.create({
      data: { id, guildId, openKey: guildId, status: "open", openedAt: now, closesAt, stallAt, potMinor: 0n, bonusMinor: 0n, ticketCount: 0, rolloverCount: 0 },
    });
    await enqueueJob(tx, { guildId, jobType: "lottery.close", payload: { drawId: id }, idempotencyKey: `lottery-close:${id}:${closesAt.toISOString()}`, runAt: closesAt });
    await enqueueJob(tx, { guildId, jobType: "lottery.stall", payload: { drawId: id }, idempotencyKey: `lottery-stall:${id}`, runAt: stallAt });
    return { settings, draw };
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    const draw = await tx.lotteryDraw.findFirst({ where: { guildId, status: "open" } });
    return { settings, draw };
  }
}

function presentDraw(draw: { id: string; status: string; openedAt: Date; closesAt: Date | null; stallAt: Date; potMinor: bigint; bonusMinor: bigint; ticketCount: number; rolloverCount: number; winnerTicketId: string; winnerUserId: string; settledAt: Date | null }) {
  return {
    drawId: draw.id,
    status: draw.status,
    openedAt: draw.openedAt.toISOString(),
    deadline: draw.closesAt?.toISOString() ?? null,
    stallAt: draw.stallAt.toISOString(),
    pot: money(draw.potMinor),
    bonus: money(draw.bonusMinor),
    tickets: draw.ticketCount,
    rollovers: draw.rolloverCount,
    winnerTicketId: draw.winnerTicketId,
    winnerUserId: draw.winnerUserId,
    settledAt: draw.settledAt?.toISOString() ?? null,
  };
}

export async function readDraw(db: Writer, input: { guildId: string; userId: string }) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  return db.$transaction(async (tx) => {
    const { settings, draw } = await ensureOpenDraw(tx, input.guildId, new Date());
    const budget = await ensureBudget(tx, input.guildId);
    if (!draw || !draw.closesAt) {
      return { result: "schedule_required" as const, rules: LOTTERY_RULES, clock: "unset" as const, budgetRemaining: money(remaining(budget)) };
    }
    const tickets = await tx.lotteryTicket.findMany({ where: { drawId: draw.id } });
    const memberTickets = tickets.filter((ticket) => ticket.userId === input.userId).length;
    const entries = new Set(tickets.map((ticket) => ticket.userId)).size;
    return {
      result: "ready" as const,
      rules: LOTTERY_RULES,
      clock: { hour: settings.hour, minute: settings.minute, timezone: "Australia/Perth" },
      budgetRemaining: money(remaining(budget)),
      entries,
      memberTickets,
      oddsBasisPoints: lotteryOdds(memberTickets, tickets.length),
      ...presentDraw(draw),
    };
  });
}

export async function readHistory(db: Writer, guildId: string) {
  if (!(await openEconomy(db, guildId))) {
    return { result: "maintenance" as const };
  }
  const rows = await db.lotteryDraw.findMany({
    where: { guildId, status: { in: ["drawn", "refunded"] } },
    orderBy: { settledAt: "desc" },
    take: 20,
  });
  return { result: "ready" as const, draws: rows.map(presentDraw) };
}

export async function quoteTickets(db: Root, input: { guildId: string; userId: string; quantity?: number; idempotencyKey: string; now: Date }) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if (!input.idempotencyKey.trim()) {
    return { result: "invalid" as const };
  }
  const quantity = input.quantity ?? 1;
  const prior = await db.lotteryQuote.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (prior && prior.expiresAt > input.now && prior.status === "open") {
    return presentQuote(prior);
  }
  try {
    return await db.$transaction(async (tx) => {
      const { settings, draw } = await ensureOpenDraw(tx, input.guildId, input.now);
      if (!draw || settings.hour === null || settings.minute === null || !draw.closesAt) {
        return { result: "schedule_required" as const, rules: LOTTERY_RULES };
      }
      if (input.now.getTime() > draw.closesAt.getTime()) {
        throw new Halt("closed");
      }
      if (input.now.getTime() >= draw.stallAt.getTime()) {
        throw new Halt("stalled");
      }
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > settings.cap) {
        throw new Halt("invalid");
      }
      const priceMinor = marksToMinor(settings.ticketMarks);
      if (priceMinor === null || lotteryPriceDecision(settings.ticketMarks) !== "allowed") {
        throw new Halt("invalid");
      }
      const owned = await tx.lotteryTicket.count({ where: { drawId: draw.id, userId: input.userId } });
      if (owned + quantity > settings.cap) {
        throw new Halt("limit");
      }
      const budget = await ensureBudget(tx, input.guildId);
      const bonusMinor = lotteryBonusMinor(priceMinor) * BigInt(quantity);
      if (remaining(budget) < bonusMinor) {
        return {
          result: "unfunded" as const,
          rules: LOTTERY_RULES,
          contribution: money(priceMinor * BigInt(quantity)),
          subsidy: money(bonusMinor),
          deadline: draw.closesAt.toISOString(),
          stallAt: draw.stallAt.toISOString(),
          budgetRemaining: money(remaining(budget)),
        };
      }
      const tickets = await tx.lotteryTicket.findMany({ where: { drawId: draw.id }, select: { userId: true } });
      const id = randomUUID();
      const created = await tx.lotteryQuote.create({
        data: {
          id,
          guildId: input.guildId,
          userId: input.userId,
          drawId: draw.id,
          settingsVersion: settings.version,
          quantity,
          priceMinor: priceMinor * BigInt(quantity),
          bonusMinor,
          deadline: draw.closesAt,
          stallAt: draw.stallAt,
          oddsBasisPoints: lotteryOdds(owned + quantity, tickets.length + quantity),
          budgetRemainingMinor: remaining(budget),
          status: "open",
          idempotencyKey: input.idempotencyKey,
          expiresAt: new Date(input.now.getTime() + 60_000),
        },
      });
      return presentQuote(created, new Set(tickets.map((ticket) => ticket.userId)).size, tickets.length, owned);
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome, rules: LOTTERY_RULES };
    }
    if (isUnique(error)) {
      const again = await db.lotteryQuote.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      return again ? presentQuote(again) : { result: "closed" as const };
    }
    throw error;
  }
}

function presentQuote(quote: { id: string; quantity: number; priceMinor: bigint; bonusMinor: bigint; deadline: Date | null; stallAt: Date; oddsBasisPoints: number; budgetRemainingMinor: bigint; expiresAt: Date; drawId: string }, entries = 0, tickets = 0, memberTickets = 0) {
  return {
    result: "quoted" as const,
    quoteId: quote.id,
    drawId: quote.drawId,
    quantity: quote.quantity,
    entries,
    tickets,
    memberTickets,
    oddsBasisPoints: quote.oddsBasisPoints,
    contribution: money(quote.priceMinor),
    subsidy: money(quote.bonusMinor),
    deadline: quote.deadline?.toISOString() ?? null,
    stallAt: quote.stallAt.toISOString(),
    budgetRemaining: money(quote.budgetRemainingMinor),
    expiresAt: quote.expiresAt.toISOString(),
    rules: LOTTERY_RULES,
  };
}

export async function buyTickets(db: Root, input: { guildId: string; userId: string; quoteId: string; idempotencyKey: string; now: Date }) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if (!input.idempotencyKey.trim() || !input.quoteId.trim()) {
    return { result: "invalid" as const };
  }
  const prior = await db.lotteryPurchase.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (prior) {
    return { result: "already_recorded" as const, purchaseId: prior.id, quantity: prior.quantity };
  }
  try {
    return await db.$transaction(async (tx) => {
      const quotes = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "lottery_quote" WHERE "id" = ${input.quoteId} FOR UPDATE`;
      const quote = quotes[0] ? await tx.lotteryQuote.findUnique({ where: { id: quotes[0].id } }) : null;
      if (!quote || quote.guildId !== input.guildId || quote.userId !== input.userId) {
        throw new Halt("missing");
      }
      if (quote.expiresAt <= input.now) {
        throw new Halt("expired");
      }
      const recorded = await tx.lotteryPurchase.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (recorded) {
        return { result: "already_recorded" as const, purchaseId: recorded.id, quantity: recorded.quantity };
      }
      const draws = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "lottery_draw" WHERE "id" = ${quote.drawId} FOR UPDATE`;
      const draw = draws[0] ? await tx.lotteryDraw.findUnique({ where: { id: draws[0].id } }) : null;
      if (!draw || draw.status !== "open") {
        throw new Halt("closed");
      }
      if (quote.status !== "open") {
        throw new Halt("closed");
      }
      const settings = await ensureSettings(tx, input.guildId);
      if (settings.version !== quote.settingsVersion) {
        throw new Halt("stale");
      }
      if (!draw.closesAt || input.now.getTime() > draw.closesAt.getTime()) {
        throw new Halt("closed");
      }
      if (input.now.getTime() >= draw.stallAt.getTime()) {
        throw new Halt("stalled");
      }
      const owned = await tx.lotteryTicket.count({ where: { drawId: draw.id, userId: input.userId } });
      if (owned + quote.quantity > settings.cap) {
        throw new Halt("limit");
      }
      const budget = await ensureBudget(tx, input.guildId);
      if (remaining(budget) < quote.bonusMinor) {
        throw new Halt("unfunded");
      }
      const paid = await moveHeldCurrency(tx, {
        guildId: input.guildId,
        userId: input.userId,
        currency: "marks",
        availableDelta: -quote.priceMinor,
        escrowDelta: quote.priceMinor,
        kind: "lottery_stake",
        direction: "debit",
        amountMinor: quote.priceMinor,
        source: "lottery",
        sourceId: quote.drawId,
        pace: "market",
        idempotencyKey: input.idempotencyKey,
        reason: "Lottery ticket purchase",
        actorUserId: input.userId,
        now: input.now,
      });
      if (paid !== "ok") {
        throw new Halt(paid === "insufficient" ? "insufficient" : "invalid");
      }
      const purchaseId = randomUUID();
      await tx.lotteryPurchase.create({
        data: { id: purchaseId, guildId: input.guildId, drawId: draw.id, userId: input.userId, quantity: quote.quantity, priceMinor: quote.priceMinor, bonusMinor: quote.bonusMinor, idempotencyKey: input.idempotencyKey },
      });
      const ticketBonus = quote.bonusMinor / BigInt(quote.quantity);
      const ticketPrice = quote.priceMinor / BigInt(quote.quantity);
      await tx.lotteryTicket.createMany({
        data: Array.from({ length: quote.quantity }, () => ({
          id: randomUUID(),
          guildId: input.guildId,
          drawId: draw.id,
          purchaseId,
          userId: input.userId,
          priceMinor: ticketPrice,
          bonusMinor: ticketBonus,
        })),
      });
      await tx.lotteryDraw.update({
        where: { id: draw.id },
        data: { potMinor: { increment: quote.priceMinor }, bonusMinor: { increment: quote.bonusMinor }, ticketCount: { increment: quote.quantity } },
      });
      await tx.lotteryBudget.update({ where: { guildId: input.guildId }, data: { reservedMinor: { increment: quote.bonusMinor } } });
      await tx.lotteryQuote.update({ where: { id: quote.id }, data: { status: "used" } });
      return { result: "ready" as const, purchaseId, quantity: quote.quantity, contribution: money(quote.priceMinor), subsidy: money(quote.bonusMinor), receipt: `Receipt ${purchaseId} for ${quote.quantity} lottery tickets. ${money(quote.priceMinor)} held. Bonus ${money(quote.bonusMinor)} reserved.` };
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    if (isUnique(error)) {
      const again = await db.lotteryPurchase.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      return again
        ? { result: "already_recorded" as const, purchaseId: again.id, quantity: again.quantity }
        : { result: "closed" as const };
    }
    throw error;
  }
}

async function stakesOf(tx: Tx, drawId: string) {
  const tickets = await tx.lotteryTicket.findMany({ where: { drawId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const byUser = new Map<string, bigint>();
  for (const ticket of tickets) {
    byUser.set(ticket.userId, (byUser.get(ticket.userId) ?? 0n) + ticket.priceMinor);
  }
  const pot = tickets.reduce((sum, ticket) => sum + ticket.priceMinor, 0n);
  const bonus = tickets.reduce((sum, ticket) => sum + ticket.bonusMinor, 0n);
  return { tickets, byUser, pot, bonus };
}

export async function settleDraw(db: Root, input: { drawId: string; now: Date; randomIndex?: (max: number) => number }) {
  const randomIndex = input.randomIndex ?? ((max: number) => randomInt(0, max));
  try {
    return await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "lottery_draw" WHERE "id" = ${input.drawId} FOR UPDATE`;
      const draw = rows[0] ? await tx.lotteryDraw.findUnique({ where: { id: rows[0].id } }) : null;
      if (!draw) {
        return { result: "missing" as const };
      }
      if (draw.status !== "open") {
        return { result: "already_recorded" as const, status: draw.status, drawId: draw.id };
      }
      if (input.now.getTime() >= draw.stallAt.getTime()) {
        return refundDraw(tx, draw, input.now);
      }
      if (!draw.closesAt || input.now.getTime() < draw.closesAt.getTime()) {
        return { result: "open" as const, drawId: draw.id };
      }
      const { tickets, byUser, pot, bonus } = await stakesOf(tx, draw.id);
      const entries = byUser.size;
      if (!entrantsMet(entries)) {
        const settings = await ensureSettings(tx, draw.guildId);
        const closesAt = settings.hour === null || settings.minute === null ? null : nextPerthClock(input.now, settings.hour, settings.minute);
        await tx.lotteryDraw.update({ where: { id: draw.id }, data: { closesAt, rolloverCount: draw.rolloverCount + 1 } });
        if (closesAt) {
          await enqueueJob(tx, { guildId: draw.guildId, jobType: "lottery.close", payload: { drawId: draw.id }, idempotencyKey: `lottery-close:${draw.id}:${closesAt.toISOString()}`, runAt: closesAt });
        }
        return { result: "rolled" as const, drawId: draw.id, tickets: tickets.length, entries, pot: money(pot), bonus: money(bonus), deadline: closesAt?.toISOString() ?? null };
      }
      const snapshot: SnapshotTicket[] = tickets.map((ticket) => ({ ticketId: ticket.id, userId: ticket.userId }));
      const index = snapshot.length === 0 ? 0 : randomIndex(snapshot.length);
      const winner = snapshot[index];
      if (!winner) {
        throw new Halt("invalid");
      }
      const users = [...byUser.keys()].sort();
      for (const userId of users) {
        if (userId === winner.userId) {
          continue;
        }
        const stake = byUser.get(userId) ?? 0n;
        const moved = await moveHeldCurrency(tx, {
          guildId: draw.guildId,
          userId,
          currency: "marks",
          availableDelta: 0n,
          escrowDelta: -stake,
          kind: "lottery_settle",
          direction: "debit",
          amountMinor: stake,
          source: "lottery",
          sourceId: draw.id,
          pace: "market",
          idempotencyKey: `lottery-settle:${draw.id}:${userId}`,
          reason: "Lottery pool paid to the winning ticket",
          actorUserId: "system",
          now: input.now,
        });
        if (moved !== "ok") {
          throw new Halt(moved === "insufficient" ? "insufficient" : "invalid");
        }
      }
      const ownStake = byUser.get(winner.userId) ?? 0n;
      const paid = await moveHeldCurrency(tx, {
        guildId: draw.guildId,
        userId: winner.userId,
        currency: "marks",
        availableDelta: pot + bonus,
        escrowDelta: -ownStake,
        kind: "lottery_win",
        direction: "credit",
        amountMinor: pot + bonus,
        source: "lottery",
        sourceId: draw.id,
        pace: "exceptional",
        idempotencyKey: `lottery-win:${draw.id}`,
        reason: "Lottery winning ticket",
        actorUserId: "system",
        now: input.now,
      });
      if (paid !== "ok") {
        throw new Halt(paid === "insufficient" ? "insufficient" : "invalid");
      }
      const budget = await ensureBudget(tx, draw.guildId);
      if (budget.reservedMinor < bonus) {
        throw new Halt("unfunded");
      }
      await tx.lotteryBudget.update({ where: { guildId: draw.guildId }, data: { reservedMinor: { decrement: bonus }, spentMinor: { increment: bonus } } });
      await tx.lotteryDraw.update({
        where: { id: draw.id },
        data: { status: "drawn", openKey: draw.id, potMinor: pot, bonusMinor: bonus, ticketCount: tickets.length, snapshot: json(snapshot), winnerTicketId: winner.ticketId, winnerUserId: winner.userId, winnerIndex: index, settledAt: input.now },
      });
      await openNextDraw(tx, draw.guildId, input.now);
      return { result: "drawn" as const, drawId: draw.id, winnerTicketId: winner.ticketId, winnerUserId: winner.userId, pot: money(pot), bonus: money(bonus), tickets: tickets.length };
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    throw error;
  }
}

async function refundDraw(tx: Tx, draw: { id: string; guildId: string }, now: Date) {
  const { tickets, byUser, pot, bonus } = await stakesOf(tx, draw.id);
  const users = [...byUser.keys()].sort();
  for (const userId of users) {
    const stake = byUser.get(userId) ?? 0n;
    const moved = await moveHeldCurrency(tx, {
      guildId: draw.guildId,
      userId,
      currency: "marks",
      availableDelta: stake,
      escrowDelta: -stake,
      kind: "lottery_refund",
      direction: "credit",
      amountMinor: stake,
      source: "lottery",
      sourceId: draw.id,
      pace: "market",
      idempotencyKey: `lottery-refund:${draw.id}:${userId}`,
      reason: "Lottery stall refund",
      actorUserId: "system",
      now,
    });
    if (moved !== "ok") {
      throw new Halt(moved === "insufficient" ? "insufficient" : "invalid");
    }
  }
  if (bonus > 0n) {
    const budget = await ensureBudget(tx, draw.guildId);
    if (budget.reservedMinor < bonus) {
      throw new Halt("unfunded");
    }
    await tx.lotteryBudget.update({ where: { guildId: draw.guildId }, data: { reservedMinor: { decrement: bonus } } });
  }
  await tx.lotteryDraw.update({
    where: { id: draw.id },
    data: { status: "refunded", openKey: draw.id, potMinor: pot, bonusMinor: bonus, ticketCount: tickets.length, settledAt: now },
  });
  await openNextDraw(tx, draw.guildId, now);
  return { result: "refunded" as const, drawId: draw.id, pot: money(pot), bonus: money(bonus), tickets: tickets.length };
}

async function openNextDraw(tx: Tx, guildId: string, now: Date) {
  const settings = await ensureSettings(tx, guildId);
  if (settings.hour === null || settings.minute === null) {
    return;
  }
  const existing = await tx.lotteryDraw.findFirst({ where: { guildId, status: "open" } });
  if (existing) {
    return;
  }
  const closesAt = nextPerthClock(now, settings.hour, settings.minute);
  const stallAt = new Date(now.getTime() + settings.stallDays * 86_400_000);
  const id = randomUUID();
  const draw = await tx.lotteryDraw.create({
    data: { id, guildId, openKey: guildId, status: "open", openedAt: now, closesAt, stallAt },
  });
  await enqueueJob(tx, { guildId, jobType: "lottery.close", payload: { drawId: draw.id }, idempotencyKey: `lottery-close:${draw.id}:${closesAt.toISOString()}`, runAt: closesAt });
  await enqueueJob(tx, { guildId, jobType: "lottery.stall", payload: { drawId: draw.id }, idempotencyKey: `lottery-stall:${draw.id}`, runAt: stallAt });
}

export async function sweepLottery(db: Root, now: Date) {
  const due = await db.lotteryDraw.findMany({
    where: { status: "open", OR: [{ closesAt: { lte: now } }, { stallAt: { lte: now } }] },
  });
  const results = [];
  for (const draw of due) {
    results.push(await settleDraw(db, { drawId: draw.id, now }));
  }
  return results;
}

export async function saveLotterySettings(db: Root, input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; ticketMarks?: number; cap?: number; stallDays?: number; hour?: number | null; minute?: number | null; clearClock?: boolean; now: Date }) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "economy_operations" })) !== "allowed") {
    return { result: "denied" as const };
  }
  return db.$transaction(async (tx) => {
    const current = await ensureSettings(tx, input.guildId);
    const ticketMarks = input.ticketMarks ?? current.ticketMarks;
    const cap = input.cap ?? current.cap;
    const stallDays = input.stallDays ?? current.stallDays;
    if (lotteryPriceDecision(ticketMarks) !== "allowed" || lotteryCapDecision(cap) !== "allowed" || lotteryStallDecision(stallDays) !== "allowed") {
      return { result: "invalid" as const };
    }
    let hour = current.hour;
    let minute = current.minute;
    if (input.clearClock) {
      hour = null;
      minute = null;
    } else if (input.hour !== undefined || input.minute !== undefined) {
      const nextHour = input.hour === undefined ? current.hour : input.hour;
      const nextMinute = input.minute === undefined ? current.minute : input.minute;
      const clock = lotteryClockDecision(nextHour, nextMinute);
      if (clock === "invalid") {
        return { result: "invalid" as const };
      }
      hour = nextHour;
      minute = nextMinute;
    }
    const saved = await tx.lotterySettings.update({
      where: { guildId: input.guildId },
      data: { ticketMarks, cap, stallDays, hour, minute, version: current.version + 1 },
    });
    const open = await tx.lotteryDraw.findFirst({ where: { guildId: input.guildId, status: "open" } });
    if (saved.hour !== null && saved.minute !== null) {
      const closesAt = nextPerthClock(input.now, saved.hour, saved.minute);
      if (open) {
        await tx.lotteryDraw.update({ where: { id: open.id }, data: { closesAt } });
        await enqueueJob(tx, { guildId: input.guildId, jobType: "lottery.close", payload: { drawId: open.id }, idempotencyKey: `lottery-close:${open.id}:${closesAt.toISOString()}`, runAt: closesAt });
      } else {
        await ensureOpenDraw(tx, input.guildId, input.now);
      }
    } else if (open) {
      await tx.lotteryDraw.update({ where: { id: open.id }, data: { closesAt: null } });
    }
    await writeAudit(tx, { guildId: input.guildId, actorUserId: input.actorUserId, action: "lottery.settings", targetType: "lottery_settings", targetId: input.guildId, reason: input.clearClock ? "Clear the lottery draw time" : "Save lottery settings" });
    return { result: "saved" as const, version: saved.version, hour: saved.hour, minute: saved.minute, ticketMarks: saved.ticketMarks, cap: saved.cap, stallDays: saved.stallDays };
  });
}

export async function fundLotteryBudget(db: Root, input: { guildId: string; amountMarks: number; idempotencyKey: string; reason: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date }) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "economy_operations" })) !== "allowed") {
    return { result: "denied" as const };
  }
  const amountMinor = marksToMinor(input.amountMarks);
  if (amountMinor === null || amountMinor <= 0n || !input.idempotencyKey.trim() || !input.reason.trim()) {
    return { result: "invalid" as const };
  }
  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        return { result: "already_recorded" as const };
      }
      await ensureBudget(tx, input.guildId);
      await tx.lotteryBudget.update({ where: { guildId: input.guildId }, data: { authorizedMinor: { increment: amountMinor } } });
      await tx.ledgerEntry.create({
        data: {
          id: randomUUID(),
          guildId: input.guildId,
          userId: "system",
          currency: "marks",
          direction: "credit",
          kind: "fund",
          amountMinor,
          source: "lottery",
          sourceId: input.idempotencyKey,
          pace: "exceptional",
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
          actorUserId: input.actorUserId,
          createdAt: input.now,
        },
      });
      await writeAudit(tx, { guildId: input.guildId, actorUserId: input.actorUserId, action: "lottery.fund", targetType: "lottery_budget", targetId: input.guildId, reason: input.reason });
      return { result: "funded" as const, amount: money(amountMinor) };
    });
  } catch (error) {
    if (!isUnique(error)) {
      throw error;
    }
    return { result: "already_recorded" as const };
  }
}

export async function readLotteryStaff(db: Writer, guildId: string) {
  if (!(await openEconomy(db, guildId))) {
    return { result: "maintenance" as const };
  }
  return db.$transaction(async (tx) => {
    const settings = await ensureSettings(tx, guildId);
    const budget = await ensureBudget(tx, guildId);
    const draw = await tx.lotteryDraw.findFirst({ where: { guildId, status: "open" } });
    const history = await tx.lotteryDraw.findMany({ where: { guildId, status: { in: ["drawn", "refunded"] } }, orderBy: { settledAt: "desc" }, take: 20 });
    const entries = draw ? new Set((await tx.lotteryTicket.findMany({ where: { drawId: draw.id }, select: { userId: true } })).map((ticket) => ticket.userId)).size : 0;
    return {
      result: "ready" as const,
      rules: LOTTERY_RULES,
      clock: settings.hour === null || settings.minute === null ? null : { hour: settings.hour, minute: settings.minute, timezone: "Australia/Perth" },
      clockLabel: settings.hour === null || settings.minute === null ? "The draw time is not selected." : `${settings.hour}:${String(settings.minute).padStart(2, "0")} Australia/Perth`,
      ticketMarks: settings.ticketMarks,
      cap: settings.cap,
      stallDays: settings.stallDays,
      version: settings.version,
      budgetAuthorized: money(budget.authorizedMinor),
      budgetReserved: money(budget.reservedMinor),
      budgetSpent: money(budget.spentMinor),
      budgetRemaining: money(remaining(budget)),
      draw: draw ? { ...presentDraw(draw), entries } : null,
      history: history.map(presentDraw),
    };
  });
}
