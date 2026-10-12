import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";
import { fundExceptional, issueMarks } from "./ledger.js";
import { buyTickets, fundLotteryBudget, quoteTickets, readHistory, readLotteryStaff, saveLotterySettings, settleDraw } from "./lottery.js";
import { grantCapability } from "./platform.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const now = new Date("2026-10-12T02:00:00.000Z");
const closeAt = new Date("2026-10-12T07:00:00.000Z");
const nextClose = new Date("2026-10-13T07:00:00.000Z");
const staff = ["staff"];

async function wallet(userId: string) {
  const row = await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId, userId, currency: "marks" } } });
  return { available: row?.availableMinor ?? 0n, escrow: row?.escrowMinor ?? 0n };
}

afterAll(async () => {
  await db.lotteryTicket.deleteMany({ where: { guildId } });
  await db.lotteryPurchase.deleteMany({ where: { guildId } });
  await db.lotteryQuote.deleteMany({ where: { guildId } });
  await db.lotteryDraw.deleteMany({ where: { guildId } });
  await db.lotteryBudget.deleteMany({ where: { guildId } });
  await db.lotterySettings.deleteMany({ where: { guildId } });
  await db.job.deleteMany({ where: { guildId } });
  await db.ledgerEntry.deleteMany({ where: { guildId } });
  await db.wallet.deleteMany({ where: { guildId } });
  await db.issuanceBudget.deleteMany({ where: { guildId } });
  await db.economySettings.deleteMany({ where: { guildId } });
  await db.auditRecord.deleteMany({ where: { guildId } });
  await db.capabilityGrant.deleteMany({ where: { guildId } });
  await db.guild.deleteMany({ where: { guildId } });
  await db.$disconnect();
});

describe("funded daily lottery", () => {
  it("carries a short draw once, pays one ticket, and refunds a stalled draw", async () => {
    await grantCapability(db, { guildId, roleId: "staff", capability: "economy_operations", actorUserId: "owner", reason: "test" });
    expect(await fundExceptional(db, { guildId, amountMarks: 80000, idempotencyKey: "lottery-pool", reason: "Lottery test", actorUserId: "owner", actorRoleIds: staff, now })).toMatchObject({ result: "funded" });
    for (const userId of ["alpha", "beta", "gamma"]) {
      expect(await issueMarks(db, { guildId, userId, amountMarks: 20000, source: "lottery.test", sourceId: userId, pace: "exceptional", idempotencyKey: `fund:${userId}`, reason: "Lottery test", actorUserId: "owner", now })).toMatchObject({ result: "posted" });
    }

    const beforeClock = await readLotteryStaff(db, guildId);
    expect(beforeClock).toMatchObject({ result: "ready", clock: null, clockLabel: "The draw time is not selected." });
    const beforeQuote = await wallet("alpha");
    expect(await quoteTickets(db, { guildId, userId: "alpha", quantity: 1, idempotencyKey: "quote-early", now })).toMatchObject({ result: "schedule_required" });
    expect(await wallet("alpha")).toEqual(beforeQuote);

    expect(await saveLotterySettings(db, { guildId, actorUserId: "owner", actorRoleIds: staff, hour: 15, minute: 0, now })).toMatchObject({ result: "saved", hour: 15, minute: 0 });
    expect(await readLotteryStaff(db, guildId)).toMatchObject({ clock: { hour: 15, minute: 0, timezone: "Australia/Perth" }, clockLabel: "15:00 Australia/Perth" });
    const opened = await db.lotteryDraw.findFirst({ where: { guildId, status: "open" } });
    expect(opened?.closesAt?.toISOString()).toBe(closeAt.toISOString());

    expect(await fundLotteryBudget(db, { guildId, amountMarks: 40, idempotencyKey: "lottery-fund-short", reason: "Short lottery budget", actorUserId: "owner", actorRoleIds: staff, now })).toMatchObject({ result: "funded" });
    const short = await quoteTickets(db, { guildId, userId: "alpha", quantity: 1, idempotencyKey: "quote-short", now });
    expect(short).toMatchObject({ result: "unfunded", contribution: "100.00", subsidy: "50.00", budgetRemaining: "40.00" });
    expect(await wallet("alpha")).toEqual(beforeQuote);
    expect(await db.lotteryBudget.findUnique({ where: { guildId } })).toMatchObject({ reservedMinor: 0n, spentMinor: 0n });

    expect(await fundLotteryBudget(db, { guildId, amountMarks: 20000, idempotencyKey: "lottery-fund", reason: "Fund the lottery budget", actorUserId: "owner", actorRoleIds: staff, now })).toMatchObject({ result: "funded" });
    const quoted = await quoteTickets(db, { guildId, userId: "alpha", quantity: 1, idempotencyKey: "quote-1", now });
    expect(quoted).toMatchObject({ result: "quoted", contribution: "100.00", subsidy: "50.00", entries: 0, tickets: 0, oddsBasisPoints: 10000, deadline: closeAt.toISOString() });
    expect(await wallet("alpha")).toEqual(beforeQuote);
    if (quoted.result !== "quoted") {
      throw new Error(quoted.result);
    }
    expect(quoted.rules).toContain("three distinct members");
    expect(quoted.rules).toContain("does not add that bonus again");

    const first = await buyTickets(db, { guildId, userId: "alpha", quoteId: quoted.quoteId, idempotencyKey: "t1", now });
    const retry = await buyTickets(db, { guildId, userId: "alpha", quoteId: quoted.quoteId, idempotencyKey: "t1", now });
    expect(first).toMatchObject({ result: "ready", quantity: 1 });
    expect(retry).toMatchObject({ result: "already_recorded" });
    const secondQuote = await quoteTickets(db, { guildId, userId: "alpha", quantity: 1, idempotencyKey: "quote-2", now });
    if (secondQuote.result !== "quoted") {
      throw new Error(secondQuote.result);
    }
    const parallel = await Promise.all([
      buyTickets(db, { guildId, userId: "alpha", quoteId: secondQuote.quoteId, idempotencyKey: "t2", now }),
      buyTickets(db, { guildId, userId: "alpha", quoteId: secondQuote.quoteId, idempotencyKey: "t2", now }),
    ]);
    expect(parallel.filter((row) => row.result === "ready")).toHaveLength(1);
    expect(parallel.filter((row) => row.result === "already_recorded")).toHaveLength(1);
    for (const key of ["t3", "t4", "t5"]) {
      const next = await quoteTickets(db, { guildId, userId: "alpha", quantity: 1, idempotencyKey: `quote-${key}`, now });
      if (next.result !== "quoted") {
        throw new Error(next.result);
      }
      expect(await buyTickets(db, { guildId, userId: "alpha", quoteId: next.quoteId, idempotencyKey: key, now })).toMatchObject({ result: "ready" });
    }
    expect(await db.lotteryTicket.count({ where: { guildId, userId: "alpha" } })).toBe(5);
    expect(await wallet("alpha")).toEqual({ available: beforeQuote.available - 50_000n, escrow: 50_000n });
    expect(await db.ledgerEntry.count({ where: { guildId, userId: "alpha", kind: "lottery_stake" } })).toBe(5);

    const drawId = opened?.id ?? "";
    const rolled = await settleDraw(db, { drawId, now: closeAt, randomIndex: () => 0 });
    expect(rolled).toMatchObject({ result: "rolled", drawId, tickets: 5, entries: 1, pot: "500.00", bonus: "250.00", deadline: nextClose.toISOString() });
    expect(await db.lotteryDraw.findUnique({ where: { id: drawId } })).toMatchObject({ status: "open", bonusMinor: 25_000n, potMinor: 50_000n, rolloverCount: 1, ticketCount: 5 });
    expect(await db.ledgerEntry.count({ where: { guildId, kind: "lottery_win" } })).toBe(0);
    const beforeLimit = await wallet("alpha");
    expect(await quoteTickets(db, { guildId, userId: "alpha", quantity: 1, idempotencyKey: "quote-cap", now: closeAt })).toMatchObject({ result: "limit" });
    expect(await wallet("alpha")).toEqual(beforeLimit);

    for (const userId of ["beta", "gamma"]) {
      const quote = await quoteTickets(db, { guildId, userId, quantity: 1, idempotencyKey: `quote-${userId}`, now: closeAt });
      if (quote.result !== "quoted") {
        throw new Error(quote.result);
      }
      expect(await buyTickets(db, { guildId, userId, quoteId: quote.quoteId, idempotencyKey: `buy-${userId}`, now: closeAt })).toMatchObject({ result: "ready" });
    }
    const beforeRace = { alpha: await wallet("alpha"), beta: await wallet("beta"), gamma: await wallet("gamma") };
    const extra = await quoteTickets(db, { guildId, userId: "gamma", quantity: 1, idempotencyKey: "quote-race", now: nextClose });
    if (extra.result !== "quoted") {
      throw new Error(extra.result);
    }
    await Promise.all([
      buyTickets(db, { guildId, userId: "gamma", quoteId: extra.quoteId, idempotencyKey: "buy-race", now: nextClose }),
      settleDraw(db, { drawId, now: nextClose, randomIndex: () => 0 }),
    ]);
    const settled = await db.lotteryDraw.findUnique({ where: { id: drawId } });
    const tickets = await db.lotteryTicket.count({ where: { drawId } });
    expect(settled).toMatchObject({ status: "drawn", winnerUserId: "alpha", ticketCount: tickets });
    expect(settled?.potMinor).toBe(BigInt(tickets) * 10_000n);
    expect(settled?.bonusMinor).toBe(BigInt(tickets) * 5_000n);
    expect(Array.isArray(settled?.snapshot) ? settled.snapshot.length : 0).toBe(tickets);
    const gammaTickets = await db.lotteryTicket.count({ where: { drawId, userId: "gamma" } });
    expect(gammaTickets === 1 || gammaTickets === 2).toBe(true);
    expect(await wallet("alpha")).toEqual({ available: beforeRace.alpha.available + (settled?.potMinor ?? 0n) + (settled?.bonusMinor ?? 0n), escrow: 0n });
    expect(await wallet("beta")).toEqual({ available: beforeRace.beta.available, escrow: 0n });
    expect(await wallet("gamma")).toEqual({ available: beforeRace.gamma.available - (gammaTickets === 2 ? 10_000n : 0n), escrow: 0n });
    const afterPay = { alpha: await wallet("alpha"), beta: await wallet("beta"), gamma: await wallet("gamma") };
    expect(await settleDraw(db, { drawId, now: nextClose, randomIndex: () => 99 })).toMatchObject({ result: "already_recorded", status: "drawn" });
    expect(await wallet("alpha")).toEqual(afterPay.alpha);
    expect(await db.lotteryDraw.findUnique({ where: { id: drawId } })).toMatchObject({ winnerTicketId: settled?.winnerTicketId, winnerIndex: 0 });
    expect(await db.ledgerEntry.count({ where: { guildId, kind: "lottery_win", sourceId: drawId } })).toBe(1);
    const history = await readHistory(db, guildId);
    expect(history.result === "ready" ? history.draws.some((draw) => draw.drawId === drawId && draw.winnerUserId === "alpha") : false).toBe(true);

    const carried = await db.lotteryDraw.findFirst({ where: { guildId, status: "open" } });
    if (!carried) {
      throw new Error("missing");
    }
    const beforeStall = { alpha: await wallet("alpha"), beta: await wallet("beta"), gamma: await wallet("gamma") };
    const budgetBefore = await db.lotteryBudget.findUnique({ where: { guildId } });
    for (const userId of ["alpha", "beta", "gamma"]) {
      const quote = await quoteTickets(db, { guildId, userId, quantity: 1, idempotencyKey: `stall-${userId}`, now: nextClose });
      if (quote.result !== "quoted") {
        throw new Error(quote.result);
      }
      expect(await buyTickets(db, { guildId, userId, quoteId: quote.quoteId, idempotencyKey: `stall-buy-${userId}`, now: nextClose })).toMatchObject({ result: "ready" });
    }
    expect(await settleDraw(db, { drawId: carried.id, now: carried.stallAt, randomIndex: () => 0 })).toMatchObject({ result: "refunded", tickets: 3 });
    expect(await db.lotteryDraw.findUnique({ where: { id: carried.id } })).toMatchObject({ status: "refunded", winnerUserId: "" });
    expect(await wallet("alpha")).toEqual(beforeStall.alpha);
    expect(await wallet("beta")).toEqual(beforeStall.beta);
    expect(await wallet("gamma")).toEqual(beforeStall.gamma);
    expect(await db.lotteryBudget.findUnique({ where: { guildId } })).toMatchObject({ reservedMinor: budgetBefore?.reservedMinor ?? 0n, spentMinor: budgetBefore?.spentMinor ?? 0n });
    expect(await settleDraw(db, { drawId: carried.id, now: carried.stallAt })).toMatchObject({ result: "already_recorded", status: "refunded" });
    expect(await db.ledgerEntry.count({ where: { guildId, kind: "lottery_win" } })).toBe(1);
  });
});
