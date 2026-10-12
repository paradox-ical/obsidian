import { randomUUID } from "node:crypto";

import {
  ACTIVE_INGOTS,
  BASELINE_MARKS,
  DEFAULT_QUOTE_MS,
  DEFAULT_SPREAD_BPS,
  INGOT_TOTAL,
  MARK_MINOR_UNITS,
  PROTECTED_INGOTS,
  exampleCurve,
  formatMinor,
  integratedBuyMarks,
  integratedSellMarks,
  nextUnitBuyMarks,
  presentPublicWallet,
  redemptionLiabilityMarks,
  type IngotCurve,
} from "@collective/domain";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

import { moveHeldCurrency } from "./ledger.js";
import { actorCan, ensureGuild, moduleIsAvailable, writeAudit, type Writer } from "./platform.js";

type Tx = Prisma.TransactionClient;
type Root = PrismaClient;

interface MarketRow {
  guildId: string;
  protectedReserve: bigint;
  inventory: bigint;
  eventTreasury: bigint;
  chargeReserve: bigint;
  backingMinor: bigint;
  revision: number;
  curveVersion: number;
  baselineMarks: bigint;
  activeSupply: bigint;
  spreadBps: number;
  quoteSeconds: number;
  paused: boolean;
  panelChannelId: string | null;
  panelCoalesceUntil: Date | null;
}

const HIDDEN = new Set(["system", "treasury", "bot"]);
const COALESCE_MS = 60_000;

function curveOf(row: MarketRow): IngotCurve {
  return { baselineMarks: row.baselineMarks, activeSupply: row.activeSupply, spreadBps: BigInt(row.spreadBps) };
}

function minor(marks: bigint): bigint {
  return marks * MARK_MINOR_UNITS;
}

async function ensureMarket(db: Writer, guildId: string): Promise<void> {
  await ensureGuild(db, { guildId });
  await db.ingotMarket.upsert({
    where: { guildId },
    create: {
      guildId,
      protectedReserve: PROTECTED_INGOTS,
      inventory: ACTIVE_INGOTS,
      eventTreasury: 0n,
      chargeReserve: 0n,
      backingMinor: 0n,
      revision: 1,
      curveVersion: 1,
      baselineMarks: BASELINE_MARKS,
      activeSupply: ACTIVE_INGOTS,
      spreadBps: Number(DEFAULT_SPREAD_BPS),
      quoteSeconds: DEFAULT_QUOTE_MS / 1000,
      paused: false,
    },
    update: {},
  });
}

async function lockMarket(tx: Tx, guildId: string): Promise<MarketRow> {
  await ensureMarket(tx, guildId);
  const rows = await tx.$queryRaw<MarketRow[]>`
    SELECT "guildId", "protectedReserve", "inventory", "eventTreasury", "chargeReserve", "backingMinor",
           "revision", "curveVersion", "baselineMarks", "activeSupply", "spreadBps", "quoteSeconds",
           "paused", "panelChannelId", "panelCoalesceUntil"
    FROM "ingot_market"
    WHERE "guildId" = ${guildId}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) {
    throw new Error("Ingot market lock did not return a row.");
  }
  return row;
}

async function heldIngots(db: Writer | Tx, guildId: string): Promise<bigint> {
  const rows = await db.$queryRaw<Array<{ total: bigint }>>`
    SELECT COALESCE(SUM("availableMinor" + "escrowMinor"), 0)::bigint AS "total"
    FROM "wallet"
    WHERE "guildId" = ${guildId} AND "currency" = 'ingots'
  `;
  return BigInt(rows[0]?.total ?? 0);
}

async function assertSupply(tx: Tx, guildId: string, row: MarketRow) {
  const members = await heldIngots(tx, guildId);
  const total = row.protectedReserve + row.inventory + row.eventTreasury + row.chargeReserve + members;
  if (total !== INGOT_TOTAL || row.protectedReserve !== PROTECTED_INGOTS) {
    throw new Error("Ingot supply drifted from 5,000.");
  }
}

function presentQuote(quote: { id: string; side: string; quantity: bigint; totalMinor: bigint; expiresAt: Date; revision: number; curveVersion: number; inventoryAtQuote: bigint }) {
  const nextInventory = quote.side === "buy" ? quote.inventoryAtQuote - quote.quantity : quote.inventoryAtQuote + quote.quantity;
  return {
    quoteId: quote.id,
    side: quote.side,
    quantity: quote.quantity.toString(),
    total: formatMinor(quote.totalMinor),
    inventoryAfter: nextInventory.toString(),
    spread: "5%",
    expiresAt: quote.expiresAt.toISOString(),
    revision: quote.revision,
    curveVersion: quote.curveVersion,
    priceCeiling: null,
  };
}

export async function readMarketDiagnostics(db: Writer, guildId: string) {
  await ensureMarket(db, guildId);
  const row = await db.ingotMarket.findUniqueOrThrow({ where: { guildId } });
  const curve = curveOf(row as MarketRow);
  const members = await heldIngots(db, guildId);
  const escrowRows = await db.wallet.findMany({ where: { guildId, currency: "ingots" } });
  const escrow = escrowRows.reduce((sum, wallet) => sum + wallet.escrowMinor, 0n);
  const total = row.protectedReserve + row.inventory + row.eventTreasury + row.chargeReserve + members;
  const liabilityMarks = redemptionLiabilityMarks(row.inventory, curve) ?? -1n;
  const liabilityMinor = liabilityMarks < 0n ? -1n : minor(liabilityMarks);
  const next = nextUnitBuyMarks(row.inventory, curve);
  return {
    status: "ready" as const,
    total: total.toString(),
    protected: row.protectedReserve.toString(),
    inventory: row.inventory.toString(),
    members: (members - escrow).toString(),
    escrow: escrow.toString(),
    treasury: row.eventTreasury.toString(),
    charges: row.chargeReserve.toString(),
    conserved: total === INGOT_TOTAL && row.protectedReserve === PROTECTED_INGOTS,
    backing: formatMinor(row.backingMinor),
    liability: liabilityMinor < 0n ? "unreadable" : formatMinor(liabilityMinor),
    margin: liabilityMinor < 0n ? "unreadable" : formatMinor(row.backingMinor - liabilityMinor),
    invariant: liabilityMinor >= 0n && row.backingMinor >= liabilityMinor ? "held" as const : "broken" as const,
    revision: row.revision,
    curveVersion: row.curveVersion,
    baseline: row.baselineMarks.toString(),
    nextBuy: next === null ? null : formatMinor(minor(next)),
    priceCeiling: null,
    paused: row.paused,
    quoteSeconds: row.quoteSeconds,
  };
}

export async function readMarketChart(db: Writer, guildId: string) {
  await ensureMarket(db, guildId);
  const trades = await db.marketTrade.findMany({ where: { guildId }, orderBy: { createdAt: "asc" }, take: 50 });
  return {
    points: trades.map((trade) => ({
      at: trade.createdAt.toISOString(),
      side: trade.side,
      quantity: trade.quantity.toString(),
      total: formatMinor(trade.totalMinor),
      inventoryAfter: trade.inventoryAfter.toString(),
    })),
  };
}

export async function refreshMarketPanel(db: Writer, guildId: string, now: Date) {
  await ensureMarket(db, guildId);
  const row = await db.ingotMarket.findUniqueOrThrow({ where: { guildId } });
  if (row.panelCoalesceUntil && row.panelCoalesceUntil.getTime() > now.getTime()) {
    return { result: "coalesced" as const };
  }
  await db.ingotMarket.update({
    where: { guildId },
    data: { panelCoalesceUntil: new Date(now.getTime() + COALESCE_MS) },
  });
  if (!row.panelChannelId) {
    return { result: "setup_required" as const };
  }
  return { result: "queued" as const };
}

export async function quoteMarket(
  db: Root,
  input: { guildId: string; userId: string; side: "buy" | "sell"; quantity: number; idempotencyKey: string; now: Date },
) {
  if (!(await moduleIsAvailable(db, input.guildId, "economy"))) {
    return { result: "maintenance" as const };
  }
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0 || (input.side !== "buy" && input.side !== "sell")) {
    return { result: "invalid" as const };
  }
  const existing = await db.marketQuote.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    return { result: "already_recorded" as const, ...presentQuote(existing) };
  }
  await ensureMarket(db, input.guildId);
  const row = await db.ingotMarket.findUniqueOrThrow({ where: { guildId: input.guildId } });
  if (row.paused) {
    return { result: "maintenance" as const };
  }
  const curve = curveOf(row as MarketRow);
  const quantity = BigInt(input.quantity);
  const marks = input.side === "buy" ? integratedBuyMarks(row.inventory, quantity, curve) : integratedSellMarks(row.inventory, quantity, curve);
  if (marks === null) {
    return { result: input.side === "buy" && row.inventory <= 0n ? "depleted" as const : "unavailable" as const };
  }
  const quote = await db.marketQuote.create({
    data: {
      id: randomUUID(),
      guildId: input.guildId,
      userId: input.userId,
      side: input.side,
      quantity,
      totalMinor: minor(marks),
      revision: row.revision,
      curveVersion: row.curveVersion,
      inventoryAtQuote: row.inventory,
      status: "open",
      idempotencyKey: input.idempotencyKey,
      expiresAt: new Date(input.now.getTime() + row.quoteSeconds * 1000),
    },
  });
  return { result: "quoted" as const, ...presentQuote(quote) };
}

export async function confirmQuote(
  db: Root,
  input: { guildId: string; userId: string; quoteId: string; now: Date },
) {
  if (!(await moduleIsAvailable(db, input.guildId, "economy"))) {
    return { result: "maintenance" as const };
  }
  try {
    return await db.$transaction(async (tx) => settleQuote(tx, input));
  } catch (error) {
    if (error instanceof Error && error.message === "INGOT_SUPPLY") {
      return { result: "invariant_broken" as const };
    }
    throw error;
  }
}

async function settleQuote(tx: Tx, input: { guildId: string; userId: string; quoteId: string; now: Date }) {
  const market = await lockMarket(tx, input.guildId);
  const quotes = await tx.$queryRaw<Array<{
    id: string;
    userId: string;
    side: string;
    quantity: bigint;
    totalMinor: bigint;
    revision: number;
    curveVersion: number;
    status: string;
    expiresAt: Date;
  }>>`
    SELECT "id", "userId", "side", "quantity", "totalMinor", "revision", "curveVersion", "status", "expiresAt"
    FROM "market_quote"
    WHERE "id" = ${input.quoteId} AND "guildId" = ${input.guildId}
    FOR UPDATE
  `;
  const quote = quotes[0];
  if (!quote) {
    return { result: "missing" as const };
  }
  if (quote.userId !== input.userId) {
    return { result: "denied" as const };
  }
  if (quote.status === "committed") {
    return { result: "already_committed" as const };
  }
  if (quote.status !== "open") {
    return { result: "stale" as const };
  }
  if (market.paused) {
    return { result: "maintenance" as const };
  }
  if (input.now.getTime() >= new Date(quote.expiresAt).getTime()) {
    await tx.marketQuote.update({ where: { id: quote.id }, data: { status: "expired" } });
    return { result: "expired" as const };
  }
  if (market.revision !== quote.revision || market.curveVersion !== quote.curveVersion) {
    await tx.marketQuote.update({ where: { id: quote.id }, data: { status: "stale" } });
    return { result: "stale" as const };
  }
  const curve = curveOf(market);
  const repriced = quote.side === "buy"
    ? integratedBuyMarks(market.inventory, quote.quantity, curve)
    : integratedSellMarks(market.inventory, quote.quantity, curve);
  if (repriced === null || minor(repriced) !== quote.totalMinor) {
    await tx.marketQuote.update({ where: { id: quote.id }, data: { status: "stale" } });
    return { result: "stale" as const };
  }
  const liability = redemptionLiabilityMarks(market.inventory, curve);
  if (liability === null || market.backingMinor < minor(liability)) {
    await writeAudit(tx, {
      guildId: input.guildId,
      actorUserId: input.userId,
      action: "market.invariant",
      targetType: "ingot_market",
      targetId: input.guildId,
      reason: "Backing does not cover the redemption liability.",
    });
    return { result: "invariant_broken" as const };
  }
  if (quote.side === "sell" && market.backingMinor < quote.totalMinor) {
    await writeAudit(tx, {
      guildId: input.guildId,
      actorUserId: input.userId,
      action: "market.unbacked",
      targetType: "ingot_market",
      targetId: quote.id,
      reason: "A sell was refused because backing cannot pay it.",
    });
    return { result: "unbacked" as const };
  }
  const key = `market:${quote.id}`;
  if (quote.side === "buy") {
    const paid = await moveHeldCurrency(tx, movement(input, quote, "marks", -quote.totalMinor, 0n, "debit", `${key}:marks`));
    if (paid !== "ok") {
      return { result: paid === "insufficient" ? "insufficient" as const : "already_committed" as const };
    }
    const received = await moveHeldCurrency(tx, movement(input, quote, "ingots", quote.quantity, 0n, "credit", `${key}:ingots`));
    if (received !== "ok") {
      throw new Error("INGOT_SUPPLY");
    }
  } else {
    const returned = await moveHeldCurrency(tx, movement(input, quote, "ingots", -quote.quantity, 0n, "debit", `${key}:ingots`));
    if (returned !== "ok") {
      return { result: returned === "insufficient" ? "insufficient" as const : "already_committed" as const };
    }
    const payout = await moveHeldCurrency(tx, movement(input, quote, "marks", quote.totalMinor, 0n, "credit", `${key}:marks`));
    if (payout !== "ok") {
      throw new Error("INGOT_SUPPLY");
    }
  }
  const inventory = quote.side === "buy" ? market.inventory - quote.quantity : market.inventory + quote.quantity;
  const backing = quote.side === "buy" ? market.backingMinor + quote.totalMinor : market.backingMinor - quote.totalMinor;
  const nextLiability = redemptionLiabilityMarks(inventory, curve);
  if (nextLiability === null || backing < minor(nextLiability)) {
    throw new Error("INGOT_SUPPLY");
  }
  const revision = market.revision + 1;
  await tx.ingotMarket.update({
    where: { guildId: input.guildId },
    data: { inventory, backingMinor: backing, revision },
  });
  await tx.marketQuote.update({ where: { id: quote.id }, data: { status: "committed" } });
  await tx.marketTrade.create({
    data: {
      id: randomUUID(),
      guildId: input.guildId,
      quoteId: quote.id,
      userId: input.userId,
      side: quote.side,
      quantity: quote.quantity,
      totalMinor: quote.totalMinor,
      inventoryAfter: inventory,
      revisionAfter: revision,
    },
  });
  await assertSupply(tx, input.guildId, { ...market, inventory, backingMinor: backing });
  return {
    result: "committed" as const,
    side: quote.side,
    quantity: quote.quantity.toString(),
    total: formatMinor(quote.totalMinor),
    inventory: inventory.toString(),
    revision,
  };
}

function movement(
  input: { guildId: string; userId: string; now: Date },
  quote: { id: string; quantity: bigint; totalMinor: bigint; side: string },
  currency: "marks" | "ingots",
  availableDelta: bigint,
  escrowDelta: bigint,
  direction: "credit" | "debit",
  idempotencyKey: string,
) {
  const amount = availableDelta < 0n ? -availableDelta : availableDelta;
  return {
    guildId: input.guildId,
    userId: input.userId,
    currency,
    availableDelta,
    escrowDelta,
    kind: quote.side === "buy" ? "market_buy" : "market_sell",
    direction,
    amountMinor: currency === "ingots" ? quote.quantity : quote.totalMinor === amount ? quote.totalMinor : amount,
    source: "market",
    sourceId: quote.id,
    pace: "market",
    idempotencyKey,
    reason: "Ingot exchange",
    actorUserId: input.userId,
    now: input.now,
  };
}

export async function holdIngotsForShop(
  db: Root,
  input: { guildId: string; userId: string; quantity: number; idempotencyKey: string; now: Date },
) {
  return moveShopIngots(db, { ...input, kind: "hold" });
}

export async function commitShopIngots(
  db: Root,
  input: { guildId: string; userId: string; quantity: number; idempotencyKey: string; now: Date },
) {
  return moveShopIngots(db, { ...input, kind: "commit" });
}

export async function refundShopIngots(
  db: Root,
  input: { guildId: string; userId: string; quantity: number; idempotencyKey: string; now: Date },
) {
  return moveShopIngots(db, { ...input, kind: "refund" });
}

export async function applyShopIngotMove(
  tx: Tx,
  input: { guildId: string; userId: string; quantity: number; idempotencyKey: string; now: Date; kind: "hold" | "commit" | "refund" | "reverse" },
) {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    return { result: "invalid" as const };
  }
  const quantity = BigInt(input.quantity);
  const market = await lockMarket(tx, input.guildId);
  if (input.kind === "commit" || input.kind === "reverse") {
    const inventory = input.kind === "commit" ? market.inventory + quantity : market.inventory - quantity;
    if (input.kind === "reverse" && market.inventory < quantity) {
      return { result: "insufficient" as const };
    }
    const moved = await moveHeldCurrency(tx, {
      guildId: input.guildId,
      userId: input.userId,
      currency: "ingots",
      availableDelta: input.kind === "reverse" ? quantity : 0n,
      escrowDelta: input.kind === "commit" ? -quantity : 0n,
      kind: input.kind === "commit" ? "escrow_commit" : "escrow_reverse",
      direction: input.kind === "commit" ? "debit" : "credit",
      amountMinor: quantity,
      source: "shop",
      sourceId: input.idempotencyKey,
      pace: "escrow",
      idempotencyKey: input.idempotencyKey,
      reason: input.kind === "commit" ? "Shop purchase committed" : "Shop purchase returned before reveal",
      actorUserId: input.userId,
      now: input.now,
    });
    if (moved !== "ok") {
      return { result: moved === "insufficient" ? "insufficient" as const : "already_recorded" as const };
    }
    if (inventory > market.activeSupply) {
      throw new Error("INGOT_SUPPLY");
    }
    await tx.ingotMarket.update({ where: { guildId: input.guildId }, data: { inventory, revision: market.revision + 1 } });
    await assertSupply(tx, input.guildId, { ...market, inventory });
    return { result: "ok" as const, inventory: inventory.toString() };
  }
  const moved = await moveHeldCurrency(tx, {
    guildId: input.guildId,
    userId: input.userId,
    currency: "ingots",
    availableDelta: input.kind === "hold" ? -quantity : quantity,
    escrowDelta: input.kind === "hold" ? quantity : -quantity,
    kind: input.kind === "hold" ? "escrow_hold" : "escrow_release",
    direction: input.kind === "hold" ? "debit" : "credit",
    amountMinor: quantity,
    source: "shop",
    sourceId: input.idempotencyKey,
    pace: "escrow",
    idempotencyKey: input.idempotencyKey,
    reason: input.kind === "hold" ? "Shop purchase held" : "Shop purchase refunded",
    actorUserId: input.userId,
    now: input.now,
  });
  if (moved !== "ok") {
    return { result: moved === "insufficient" ? "insufficient" as const : "already_recorded" as const };
  }
  await assertSupply(tx, input.guildId, market);
  return { result: "ok" as const, inventory: market.inventory.toString() };
}

async function moveShopIngots(
  db: Root,
  input: { guildId: string; userId: string; quantity: number; idempotencyKey: string; now: Date; kind: "hold" | "commit" | "refund" },
) {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    return { result: "invalid" as const };
  }
  return db.$transaction(async (tx) => {
    const moved = await applyShopIngotMove(tx, input);
    if (moved.result === "insufficient") {
      return { result: "insufficient" as const };
    }
    if (moved.result === "already_recorded") {
      return { result: "already_recorded" as const };
    }
    if (moved.result !== "ok") {
      return { result: "invalid" as const };
    }
    if (input.kind === "commit") {
      return { result: "committed" as const, inventory: moved.inventory ?? "0" };
    }
    return { result: input.kind === "hold" ? "held" as const : "refunded" as const };
  });
}

export async function transferIngots(
  db: Root,
  input: { guildId: string; fromUserId: string; toUserId: string; quantity: number; idempotencyKey: string; now: Date },
) {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0 || input.fromUserId === input.toUserId) {
    return { result: "invalid" as const };
  }
  const quantity = BigInt(input.quantity);
  return db.$transaction(async (tx) => {
    const market = await lockMarket(tx, input.guildId);
    const debit = await moveHeldCurrency(tx, {
      guildId: input.guildId,
      userId: input.fromUserId,
      currency: "ingots",
      availableDelta: -quantity,
      escrowDelta: 0n,
      kind: "transfer_out",
      direction: "debit",
      amountMinor: quantity,
      source: "transfer",
      sourceId: input.toUserId,
      pace: "transfer",
      idempotencyKey: input.idempotencyKey,
      reason: "Ingot transfer",
      actorUserId: input.fromUserId,
      now: input.now,
    });
    if (debit !== "ok") {
      return { result: debit === "insufficient" ? "insufficient" as const : "already_recorded" as const };
    }
    const credit = await moveHeldCurrency(tx, {
      guildId: input.guildId,
      userId: input.toUserId,
      currency: "ingots",
      availableDelta: quantity,
      escrowDelta: 0n,
      kind: "transfer_in",
      direction: "credit",
      amountMinor: quantity,
      source: "transfer",
      sourceId: input.fromUserId,
      pace: "transfer",
      idempotencyKey: `${input.idempotencyKey}:credit`,
      reason: "Ingot transfer",
      actorUserId: input.fromUserId,
      now: input.now,
    });
    if (credit !== "ok") {
      throw new Error("INGOT_SUPPLY");
    }
    await assertSupply(tx, input.guildId, market);
    return { result: "transferred" as const };
  });
}

export async function allocateEventTreasury(
  db: Root,
  input: {
    guildId: string;
    source: "member" | "pool";
    userId: string;
    quantity: number;
    idempotencyKey: string;
    actorUserId: string;
    actorRoleIds: readonly string[];
    reason: string;
    now: Date;
  },
) {
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "economy_operations" })) !== "allowed") {
    return { result: "denied" as const };
  }
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0 || !input.reason.trim()) {
    return { result: "invalid" as const };
  }
  const quantity = BigInt(input.quantity);
  return db.$transaction(async (tx) => {
    const market = await lockMarket(tx, input.guildId);
    if (input.source === "member") {
      const moved = await moveHeldCurrency(tx, {
        guildId: input.guildId,
        userId: input.userId,
        currency: "ingots",
        availableDelta: -quantity,
        escrowDelta: 0n,
        kind: "transfer_out",
        direction: "debit",
        amountMinor: quantity,
        source: "event_treasury",
        sourceId: input.idempotencyKey,
        pace: "transfer",
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        actorUserId: input.actorUserId,
        now: input.now,
      });
      if (moved !== "ok") {
        return { result: moved === "insufficient" ? "insufficient" as const : "already_recorded" as const };
      }
      await tx.ingotMarket.update({
        where: { guildId: input.guildId },
        data: { eventTreasury: market.eventTreasury + quantity },
      });
      await assertSupply(tx, input.guildId, { ...market, eventTreasury: market.eventTreasury + quantity });
    } else {
      const curve = curveOf(market);
      const cost = integratedBuyMarks(market.inventory, quantity, curve);
      if (cost === null) {
        return { result: "unavailable" as const };
      }
      const paid = await moveHeldCurrency(tx, {
        guildId: input.guildId,
        userId: input.userId,
        currency: "marks",
        availableDelta: -minor(cost),
        escrowDelta: 0n,
        kind: "market_buy",
        direction: "debit",
        amountMinor: minor(cost),
        source: "event_treasury",
        sourceId: input.idempotencyKey,
        pace: "market",
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        actorUserId: input.actorUserId,
        now: input.now,
      });
      if (paid !== "ok") {
        return { result: paid === "insufficient" ? "unfunded" as const : "already_recorded" as const };
      }
      const inventory = market.inventory - quantity;
      const backing = market.backingMinor + minor(cost);
      await tx.ingotMarket.update({
        where: { guildId: input.guildId },
        data: { inventory, eventTreasury: market.eventTreasury + quantity, backingMinor: backing, revision: market.revision + 1 },
      });
      await assertSupply(tx, input.guildId, { ...market, inventory, eventTreasury: market.eventTreasury + quantity, backingMinor: backing });
    }
    await writeAudit(tx, {
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      action: "market.treasury",
      targetType: "ingot_market",
      targetId: input.guildId,
      reason: input.reason,
    });
    return { result: "allocated" as const };
  });
}

export async function createCollapseCharge(
  db: Root,
  input: { guildId: string; holderUserId: string; quantity: number; idempotencyKey: string; actorUserId: string; actorRoleIds: readonly string[]; reason: string; now: Date },
) {
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "economy_operations" })) !== "allowed") {
    return { result: "denied" as const };
  }
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    return { result: "invalid" as const };
  }
  const existing = await db.collapseCharge.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    return { result: "already_recorded" as const, chargeId: existing.id };
  }
  const quantity = BigInt(input.quantity);
  return db.$transaction(async (tx) => {
    const market = await lockMarket(tx, input.guildId);
    if (market.eventTreasury < quantity) {
      return { result: "unfunded" as const };
    }
    const charge = await tx.collapseCharge.create({
      data: {
        id: randomUUID(),
        guildId: input.guildId,
        holderUserId: input.holderUserId,
        quantity,
        status: "funded",
        idempotencyKey: input.idempotencyKey,
        announcement: "setup_required",
      },
    });
    await tx.ingotMarket.update({
      where: { guildId: input.guildId },
      data: { eventTreasury: market.eventTreasury - quantity, chargeReserve: market.chargeReserve + quantity },
    });
    await assertSupply(tx, input.guildId, {
      ...market,
      eventTreasury: market.eventTreasury - quantity,
      chargeReserve: market.chargeReserve + quantity,
    });
    await writeAudit(tx, {
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      action: "market.collapse.create",
      targetType: "collapse_charge",
      targetId: charge.id,
      reason: input.reason,
    });
    return { result: "funded" as const, chargeId: charge.id, announcement: "setup_required" as const };
  });
}

export async function activateCollapseCharge(
  db: Root,
  input: { guildId: string; chargeId: string; actorUserId: string; now: Date },
) {
  return db.$transaction(async (tx) => {
    const market = await lockMarket(tx, input.guildId);
    const charges = await tx.$queryRaw<Array<{ id: string; quantity: bigint; status: string; holderUserId: string }>>`
      SELECT "id", "quantity", "status", "holderUserId" FROM "collapse_charge"
      WHERE "id" = ${input.chargeId} AND "guildId" = ${input.guildId}
      FOR UPDATE
    `;
    const charge = charges[0];
    if (!charge) {
      return { result: "missing" as const };
    }
    if (charge.holderUserId !== input.actorUserId) {
      return { result: "denied" as const };
    }
    if (charge.status === "activated") {
      return { result: "already_activated" as const };
    }
    if (charge.status !== "funded" || market.chargeReserve < charge.quantity) {
      return { result: "unfunded" as const };
    }
    const inventory = market.inventory + charge.quantity;
    await tx.collapseCharge.update({
      where: { id: charge.id },
      data: { status: "activated", activatedAt: input.now },
    });
    await tx.ingotMarket.update({
      where: { guildId: input.guildId },
      data: { inventory, chargeReserve: market.chargeReserve - charge.quantity, revision: market.revision + 1 },
    });
    await assertSupply(tx, input.guildId, { ...market, inventory, chargeReserve: market.chargeReserve - charge.quantity });
    await writeAudit(tx, {
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      action: "market.collapse.activate",
      targetType: "collapse_charge",
      targetId: charge.id,
      reason: "Activate a funded Market Collapse charge",
    });
    return { result: "activated" as const, inventory: inventory.toString(), announcement: "setup_required" as const };
  });
}

export async function reserveCollapseCharge(
  tx: Tx,
  input: { guildId: string; quantity: number; idempotencyKey: string; actorUserId: string; reason: string },
): Promise<{ result: "funded"; chargeId: string } | { result: "already_recorded"; chargeId: string } | { result: "unfunded" }> {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    return { result: "unfunded" };
  }
  const existing = await tx.collapseCharge.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    return { result: "already_recorded", chargeId: existing.id };
  }
  const quantity = BigInt(input.quantity);
  const market = await lockMarket(tx, input.guildId);
  if (market.eventTreasury < quantity) {
    return { result: "unfunded" };
  }
  const charge = await tx.collapseCharge.create({
    data: {
      id: randomUUID(),
      guildId: input.guildId,
      holderUserId: "",
      quantity,
      status: "funded",
      idempotencyKey: input.idempotencyKey,
      announcement: "setup_required",
    },
  });
  await tx.ingotMarket.update({
    where: { guildId: input.guildId },
    data: { eventTreasury: market.eventTreasury - quantity, chargeReserve: market.chargeReserve + quantity },
  });
  await assertSupply(tx, input.guildId, {
    ...market,
    eventTreasury: market.eventTreasury - quantity,
    chargeReserve: market.chargeReserve + quantity,
  });
  await writeAudit(tx, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "market.collapse.create",
    targetType: "collapse_charge",
    targetId: charge.id,
    reason: input.reason,
  });
  return { result: "funded", chargeId: charge.id };
}

export async function claimCollapseHolder(
  tx: Tx,
  input: { guildId: string; chargeId: string; holderUserId: string },
): Promise<"claimed" | "missing" | "taken"> {
  const charges = await tx.$queryRaw<Array<{ id: string; holderUserId: string; status: string }>>`
    SELECT "id", "holderUserId", "status" FROM "collapse_charge"
    WHERE "id" = ${input.chargeId} AND "guildId" = ${input.guildId}
    FOR UPDATE
  `;
  const charge = charges[0];
  if (!charge || charge.status !== "funded") {
    return "missing";
  }
  if (charge.holderUserId === input.holderUserId) {
    return "claimed";
  }
  if (charge.holderUserId !== "") {
    return "taken";
  }
  await tx.collapseCharge.update({ where: { id: charge.id }, data: { holderUserId: input.holderUserId } });
  return "claimed";
}

export async function releaseProtectedReserve(
  db: Writer,
  input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; reason: string },
) {
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "economy_operations" })) !== "allowed") {
    return { result: "denied" as const };
  }
  await ensureMarket(db, input.guildId);
  await writeAudit(db, {
    guildId: input.guildId,
    actorUserId: input.actorUserId,
    action: "market.reserve.refused",
    targetType: "ingot_market",
    targetId: input.guildId,
    reason: input.reason,
  });
  return { result: "policy_required" as const };
}

export async function editIngotCurve(
  db: Root,
  input: {
    guildId: string;
    baselineMarks: number;
    spreadBps: number;
    quoteSeconds: number;
    payerUserId: string;
    actorUserId: string;
    actorRoleIds: readonly string[];
    reason: string;
    now: Date;
  },
) {
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "economy_operations" })) !== "allowed") {
    return { result: "denied" as const };
  }
  if (!Number.isSafeInteger(input.baselineMarks) || input.baselineMarks <= 0 || input.spreadBps < 0 || input.spreadBps >= 10_000 || input.quoteSeconds < 1) {
    return { result: "invalid" as const };
  }
  return db.$transaction(async (tx) => {
    const market = await lockMarket(tx, input.guildId);
    const nextCurve: IngotCurve = {
      baselineMarks: BigInt(input.baselineMarks),
      activeSupply: market.activeSupply,
      spreadBps: BigInt(input.spreadBps),
    };
    const liability = redemptionLiabilityMarks(market.inventory, nextCurve);
    if (liability === null) {
      return { result: "invalid" as const };
    }
    const needed = minor(liability);
    if (needed > market.backingMinor) {
      const delta = needed - market.backingMinor;
      const paid = await moveHeldCurrency(tx, {
        guildId: input.guildId,
        userId: input.payerUserId,
        currency: "marks",
        availableDelta: -delta,
        escrowDelta: 0n,
        kind: "market_buy",
        direction: "debit",
        amountMinor: delta,
        source: "curve",
        sourceId: String(market.curveVersion + 1),
        pace: "market",
        idempotencyKey: `curve:${input.guildId}:${market.curveVersion + 1}`,
        reason: input.reason,
        actorUserId: input.actorUserId,
        now: input.now,
      });
      if (paid !== "ok") {
        return { result: "unfunded" as const };
      }
    }
    await tx.ingotMarket.update({
      where: { guildId: input.guildId },
      data: {
        baselineMarks: nextCurve.baselineMarks,
        spreadBps: input.spreadBps,
        quoteSeconds: input.quoteSeconds,
        curveVersion: market.curveVersion + 1,
        backingMinor: needed > market.backingMinor ? needed : market.backingMinor,
        paused: false,
      },
    });
    await writeAudit(tx, {
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      action: "market.curve",
      targetType: "ingot_market",
      targetId: input.guildId,
      reason: input.reason,
    });
    return { result: "updated" as const, curveVersion: market.curveVersion + 1 };
  });
}

export async function withdrawBackingMargin(
  db: Root,
  input: { guildId: string; destinationUserId: string; amountMarks: number; actorUserId: string; actorRoleIds: readonly string[]; reason: string; now: Date },
) {
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "economy_operations" })) !== "allowed") {
    return { result: "denied" as const };
  }
  if (!Number.isSafeInteger(input.amountMarks) || input.amountMarks <= 0 || !input.reason.trim()) {
    return { result: "invalid" as const };
  }
  const amount = minor(BigInt(input.amountMarks));
  return db.$transaction(async (tx) => {
    const market = await lockMarket(tx, input.guildId);
    const liability = redemptionLiabilityMarks(market.inventory, curveOf(market));
    if (liability === null) {
      return { result: "invariant_broken" as const };
    }
    const margin = market.backingMinor - minor(liability);
    if (amount > margin) {
      return { result: "insufficient" as const };
    }
    const credited = await moveHeldCurrency(tx, {
      guildId: input.guildId,
      userId: input.destinationUserId,
      currency: "marks",
      availableDelta: amount,
      escrowDelta: 0n,
      kind: "adjust",
      direction: "credit",
      amountMinor: amount,
      source: "backing",
      sourceId: input.reason,
      pace: "market",
      idempotencyKey: `withdraw:${input.guildId}:${market.revision}:${input.amountMarks}`,
      reason: input.reason,
      actorUserId: input.actorUserId,
      now: input.now,
    });
    if (credited !== "ok") {
      return { result: "already_recorded" as const };
    }
    await tx.ingotMarket.update({
      where: { guildId: input.guildId },
      data: { backingMinor: market.backingMinor - amount },
    });
    await writeAudit(tx, {
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      action: "market.withdraw",
      targetType: "ingot_market",
      targetId: input.guildId,
      reason: input.reason,
    });
    return { result: "withdrawn" as const, amount: formatMinor(amount) };
  });
}

export async function readValuedWallet(db: Writer, guildId: string, userId: string) {
  await ensureMarket(db, guildId);
  const market = await db.ingotMarket.findUniqueOrThrow({ where: { guildId } });
  const marks = await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId, userId, currency: "marks" } } });
  const ingots = await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId, userId, currency: "ingots" } } });
  const held = (ingots?.availableMinor ?? 0n) + (ingots?.escrowMinor ?? 0n);
  const sale = held === 0n ? 0n : integratedSellMarks(market.inventory, held, curveOf(market as MarketRow)) ?? 0n;
  return presentPublicWallet({
    availableMinor: marks?.availableMinor ?? 0n,
    escrowMinor: marks?.escrowMinor ?? 0n,
    ingotsAvailable: ingots?.availableMinor ?? 0n,
    ingotsEscrow: ingots?.escrowMinor ?? 0n,
    estimatedMarksMinor: (marks?.availableMinor ?? 0n) + (marks?.escrowMinor ?? 0n) + minor(sale),
  });
}

export async function ingotLeaderboardRows(db: Writer, guildId: string) {
  const wallets = await db.wallet.findMany({ where: { guildId, currency: "ingots" } });
  return wallets
    .filter((wallet) => !HIDDEN.has(wallet.userId))
    .map((wallet) => ({ userId: wallet.userId, score: Number(wallet.availableMinor + wallet.escrowMinor) }));
}

export async function wealthLeaderboardRows(db: Writer, guildId: string) {
  await ensureMarket(db, guildId);
  const market = await db.ingotMarket.findUniqueOrThrow({ where: { guildId } });
  const marks = await db.wallet.findMany({ where: { guildId, currency: "marks" } });
  const ingots = await db.wallet.findMany({ where: { guildId, currency: "ingots" } });
  const ingotByUser = new Map(ingots.map((wallet) => [wallet.userId, wallet.availableMinor + wallet.escrowMinor]));
  const users = new Set<string>([...marks.map((wallet) => wallet.userId), ...ingots.map((wallet) => wallet.userId)]);
  const curve = curveOf(market as MarketRow);
  return [...users].filter((userId) => !HIDDEN.has(userId)).map((userId) => {
    const markRow = marks.find((wallet) => wallet.userId === userId);
    const markMinor = (markRow?.availableMinor ?? 0n) + (markRow?.escrowMinor ?? 0n);
    const held = ingotByUser.get(userId) ?? 0n;
    const sale = held === 0n ? 0n : integratedSellMarks(market.inventory, held, curve) ?? 0n;
    const whole = (markMinor + minor(sale)) / MARK_MINOR_UNITS;
    const score = whole > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(whole);
    return { userId, score };
  });
}

export { exampleCurve };
