import { randomUUID } from "node:crypto";

import { formatMinor, integratedBuyMarks, MARK_MINOR_UNITS, nextUnitBuyMarks } from "@collective/domain";
import { afterAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";
import { fundExceptional, issueMarks } from "./ledger.js";
import {
  activateCollapseCharge,
  allocateEventTreasury,
  commitShopIngots,
  confirmQuote,
  createCollapseCharge,
  editIngotCurve,
  holdIngotsForShop,
  quoteMarket,
  readMarketDiagnostics,
  refreshMarketPanel,
  releaseProtectedReserve,
  withdrawBackingMargin,
} from "./market.js";
import { grantCapability } from "./platform.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const now = new Date("2026-10-11T02:00:00.000Z");
const staff = ["economy-role"];

afterAll(async () => {
  await db.marketTrade.deleteMany({ where: { guildId } });
  await db.marketQuote.deleteMany({ where: { guildId } });
  await db.collapseCharge.deleteMany({ where: { guildId } });
  await db.ingotMarket.deleteMany({ where: { guildId } });
  await db.ledgerEntry.deleteMany({ where: { guildId } });
  await db.wallet.deleteMany({ where: { guildId } });
  await db.issuanceBudget.deleteMany({ where: { guildId } });
  await db.economySettings.deleteMany({ where: { guildId } });
  await db.auditRecord.deleteMany({ where: { guildId } });
  await db.capabilityGrant.deleteMany({ where: { guildId } });
  await db.guild.deleteMany({ where: { guildId } });
  await db.$disconnect();
});

describe("ingot exchange", () => {
  it("settles the curve, blocks stale and depleted trades, and conserves 5,000 Ingots", async () => {
    await grantCapability(db, { guildId, roleId: "economy-role", capability: "economy_operations", actorUserId: "owner", reason: "Open the exchange" });
    const opened = await readMarketDiagnostics(db, guildId);
    expect(opened).toMatchObject({
      total: "5000",
      protected: "2500",
      inventory: "2500",
      conserved: true,
      nextBuy: "10000.00",
      priceCeiling: null,
      liability: "0.00",
      backing: "0.00",
      invariant: "held",
    });

    const two = await quoteMarket(db, { guildId, userId: "buyer", side: "buy", quantity: 2, idempotencyKey: "quote-two", now });
    const expectedTwo = integratedBuyMarks(2_500n, 2n);
    expect(expectedTwo).not.toBe(20_000n);
    expect(two).toMatchObject({ result: "quoted", total: formatMinor((expectedTwo ?? 0n) * MARK_MINOR_UNITS) });

    await pay("buyer", 10_000, "round");
    const buy = await quoteMarket(db, { guildId, userId: "buyer", side: "buy", quantity: 1, idempotencyKey: "quote-buy-1", now });
    if (buy.result !== "quoted") {
      throw new Error("Buy quote was not created.");
    }
    expect(await confirmQuote(db, { guildId, userId: "buyer", quoteId: buy.quoteId, now })).toMatchObject({ result: "committed", total: "10000.00", inventory: "2499" });
    const sell = await quoteMarket(db, { guildId, userId: "buyer", side: "sell", quantity: 1, idempotencyKey: "quote-sell-1", now });
    if (sell.result !== "quoted") {
      throw new Error("Sell quote was not created.");
    }
    expect(sell.total).toBe("9500.00");
    expect(await confirmQuote(db, { guildId, userId: "buyer", quoteId: sell.quoteId, now })).toMatchObject({ result: "committed", inventory: "2500" });
    expect(await withdrawBackingMargin(db, {
      guildId,
      destinationUserId: "buyer",
      amountMarks: 500,
      actorUserId: "staff",
      actorRoleIds: staff,
      reason: "Withdraw the spread",
      now,
    })).toMatchObject({ result: "withdrawn" });
    expect(await withdrawBackingMargin(db, {
      guildId,
      destinationUserId: "buyer",
      amountMarks: 1,
      actorUserId: "staff",
      actorRoleIds: staff,
      reason: "Withdraw below the liability",
      now,
    })).toMatchObject({ result: "insufficient" });

    await pay("racer-a", 10_000, "race-a");
    await pay("racer-b", 10_000, "race-b");
    const first = await quoteMarket(db, { guildId, userId: "racer-a", side: "buy", quantity: 1, idempotencyKey: "race-quote-a", now });
    const second = await quoteMarket(db, { guildId, userId: "racer-b", side: "buy", quantity: 1, idempotencyKey: "race-quote-b", now });
    if (first.result !== "quoted" || second.result !== "quoted") {
      throw new Error("Race quotes were not created.");
    }
    expect(await confirmQuote(db, { guildId, userId: "racer-a", quoteId: first.quoteId, now })).toMatchObject({ result: "committed" });
    expect(await confirmQuote(db, { guildId, userId: "racer-b", quoteId: second.quoteId, now })).toMatchObject({ result: "stale" });
    expect(await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId, userId: "racer-b", currency: "marks" } } })).toMatchObject({ availableMinor: 1_000_000n });

    const expiring = await quoteMarket(db, { guildId, userId: "racer-b", side: "buy", quantity: 1, idempotencyKey: "quote-expire", now });
    if (expiring.result !== "quoted") {
      throw new Error("Expiring quote was not created.");
    }
    const later = new Date(now.getTime() + 31_000);
    expect(await confirmQuote(db, { guildId, userId: "racer-b", quoteId: expiring.quoteId, now: later })).toMatchObject({ result: "expired" });
    expect(await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId, userId: "racer-b", currency: "marks" } } })).toMatchObject({ availableMinor: 1_000_000n });

    const pending = await quoteMarket(db, { guildId, userId: "racer-b", side: "buy", quantity: 1, idempotencyKey: "quote-before-curve", now: later });
    expect(await editIngotCurve(db, {
      guildId,
      baselineMarks: 20_000,
      spreadBps: 500,
      quoteSeconds: 30,
      payerUserId: "broke",
      actorUserId: "staff",
      actorRoleIds: staff,
      reason: "Raise the baseline without funding",
      now: later,
    })).toMatchObject({ result: "unfunded" });
    await pay("patron", 10_000, "curve");
    expect(await editIngotCurve(db, {
      guildId,
      baselineMarks: 20_000,
      spreadBps: 500,
      quoteSeconds: 30,
      payerUserId: "patron",
      actorUserId: "staff",
      actorRoleIds: staff,
      reason: "Raise the baseline",
      now: later,
    })).toMatchObject({ result: "updated" });
    if (pending.result !== "quoted") {
      throw new Error("Curve quote was not created.");
    }
    const beforeCurveConfirm = await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId, userId: "racer-b", currency: "marks" } } });
    expect(await confirmQuote(db, { guildId, userId: "racer-b", quoteId: pending.quoteId, now: later })).toMatchObject({ result: "stale" });
    expect(await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId, userId: "racer-b", currency: "marks" } } })).toMatchObject({
      availableMinor: beforeCurveConfirm?.availableMinor,
    });
    expect(await editIngotCurve(db, {
      guildId,
      baselineMarks: 10_000,
      spreadBps: 500,
      quoteSeconds: 30,
      payerUserId: "racer-b",
      actorUserId: "staff",
      actorRoleIds: staff,
      reason: "Restore the baseline",
      now: later,
    })).toMatchObject({ result: "updated" });

    const inventory = await db.ingotMarket.findUniqueOrThrow({ where: { guildId } });
    const remaining = Number(inventory.inventory);
    const cost = integratedBuyMarks(inventory.inventory, inventory.inventory);
    expect(cost).not.toBeNull();
    const affordable = Number(cost);
    expect(Number.isSafeInteger(affordable)).toBe(true);
    await pay("whale", affordable, "whale");
    const sweep = await quoteMarket(db, { guildId, userId: "whale", side: "buy", quantity: remaining, idempotencyKey: "quote-sweep", now: later });
    if (sweep.result !== "quoted") {
      throw new Error("Sweep quote was not created.");
    }
    expect(sweep.total).not.toBe(formatMinor(BigInt(remaining) * 10_000n * MARK_MINOR_UNITS));
    expect(await confirmQuote(db, { guildId, userId: "whale", quoteId: sweep.quoteId, now: later })).toMatchObject({ result: "committed", inventory: "0" });
    expect(await quoteMarket(db, { guildId, userId: "whale", side: "buy", quantity: 1, idempotencyKey: "quote-empty", now: later })).toMatchObject({ result: "depleted" });

    expect(await holdIngotsForShop(db, { guildId, userId: "whale", quantity: 1, idempotencyKey: "shop-hold", now: later })).toMatchObject({ result: "held" });
    const beforeReturn = await readMarketDiagnostics(db, guildId);
    expect(beforeReturn.inventory).toBe("0");
    expect(await commitShopIngots(db, { guildId, userId: "whale", quantity: 1, idempotencyKey: "shop-commit", now: later })).toMatchObject({ result: "committed", inventory: "1" });
    const afterReturn = await readMarketDiagnostics(db, guildId);
    expect(afterReturn.backing).toBe(beforeReturn.backing);
    expect(afterReturn.invariant).toBe("held");
    expect(afterReturn.conserved).toBe(true);
    const huge = await quoteMarket(db, { guildId, userId: "spotter", side: "buy", quantity: 1, idempotencyKey: "quote-huge", now: later });
    expect(huge).toMatchObject({ result: "quoted", total: formatMinor((nextUnitBuyMarks(1n) ?? 0n) * MARK_MINOR_UNITS) });
    expect(nextUnitBuyMarks(1n)).toBe(156_250_000_000_000n);

    const lastPrice = Number(nextUnitBuyMarks(1n));
    await pay("last-a", lastPrice, "last-a");
    await pay("last-b", lastPrice, "last-b");
    const lastA = await quoteMarket(db, { guildId, userId: "last-a", side: "buy", quantity: 1, idempotencyKey: "last-a", now: later });
    const lastB = await quoteMarket(db, { guildId, userId: "last-b", side: "buy", quantity: 1, idempotencyKey: "last-b", now: later });
    if (lastA.result !== "quoted" || lastB.result !== "quoted") {
      throw new Error("Last-unit quotes were not created.");
    }
    const raced = await Promise.all([
      confirmQuote(db, { guildId, userId: "last-a", quoteId: lastA.quoteId, now: later }),
      confirmQuote(db, { guildId, userId: "last-b", quoteId: lastB.quoteId, now: later }),
    ]);
    expect(raced.map((row) => row.result).sort()).toEqual(["committed", "stale"]);
    expect(await db.ingotMarket.findUnique({ where: { guildId } })).toMatchObject({ inventory: 0n, protectedReserve: 2500n });

    expect(await allocateEventTreasury(db, {
      guildId,
      source: "member",
      userId: "whale",
      quantity: 1,
      idempotencyKey: "treasury-1",
      actorUserId: "staff",
      actorRoleIds: staff,
      reason: "Fund a collapse charge",
      now: later,
    })).toMatchObject({ result: "allocated" });
    expect(await createCollapseCharge(db, {
      guildId,
      holderUserId: "holder",
      quantity: 1,
      idempotencyKey: "charge-1",
      actorUserId: "staff",
      actorRoleIds: staff,
      reason: "Create a funded charge",
      now: later,
    })).toMatchObject({ result: "funded", announcement: "setup_required" });
    expect(await createCollapseCharge(db, {
      guildId,
      holderUserId: "holder",
      quantity: 1,
      idempotencyKey: "charge-empty",
      actorUserId: "staff",
      actorRoleIds: staff,
      reason: "Create an unfunded charge",
      now: later,
    })).toMatchObject({ result: "unfunded" });
    const charge = await db.collapseCharge.findFirstOrThrow({ where: { guildId, idempotencyKey: "charge-1" } });
    const backingBefore = (await readMarketDiagnostics(db, guildId)).backing;
    expect(await activateCollapseCharge(db, { guildId, chargeId: charge.id, actorUserId: "holder", now: later })).toMatchObject({ result: "activated", inventory: "1" });
    expect(await activateCollapseCharge(db, { guildId, chargeId: charge.id, actorUserId: "holder", now: later })).toMatchObject({ result: "already_activated" });
    const closed = await readMarketDiagnostics(db, guildId);
    expect(closed.backing).toBe(backingBefore);
    expect(closed).toMatchObject({ total: "5000", protected: "2500", conserved: true, invariant: "held" });
    expect(await releaseProtectedReserve(db, { guildId, actorUserId: "staff", actorRoleIds: staff, reason: "Try to release the reserve" })).toMatchObject({ result: "policy_required" });
    expect(await db.ingotMarket.findUnique({ where: { guildId } })).toMatchObject({ protectedReserve: 2500n });
    expect(await refreshMarketPanel(db, guildId, later)).toMatchObject({ result: "setup_required" });
    expect(await refreshMarketPanel(db, guildId, later)).toMatchObject({ result: "coalesced" });
  });
});

async function pay(userId: string, marks: number, key: string) {
  await fundExceptional(db, {
    guildId,
    amountMarks: marks,
    idempotencyKey: `fund:${key}`,
    reason: "Fund an exchange participant",
    actorUserId: "staff",
    actorRoleIds: staff,
    now,
  });
  await issueMarks(db, {
    guildId,
    userId,
    amountMarks: marks,
    source: "lottery",
    sourceId: key,
    pace: "exceptional",
    idempotencyKey: `issue:${key}`,
    reason: "Fund an exchange participant",
    actorUserId: "system",
    now,
  });
}
