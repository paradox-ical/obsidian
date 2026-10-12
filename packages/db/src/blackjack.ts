import { randomInt, randomUUID } from "node:crypto";

import {
  BLACKJACK_DECKS,
  BLACKJACK_HOUSE,
  BLACKJACK_JOIN_SECONDS,
  BLACKJACK_TABLE_CAP,
  BLACKJACK_TURN_SECONDS,
  type BlackjackRules,
  betAllowed,
  blackjackRulesText,
  defaultBlackjackRules,
  drawDealer,
  exactProfit,
  formatMinor,
  handPayout,
  handTotal,
  marksStake,
  orderedShoe,
  perthPeriod,
  prepareBlackjackSettings,
  presentDealer,
  sameRank,
  shuffleShoe,
  simulateBlackjackEconomy,
  worstCaseProfitMinor,
} from "@collective/domain";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

import { moveHeldCurrency } from "./ledger.js";
import { actorCan, enqueueJob, ensureGuild, moduleIsAvailable, writeAudit, type Writer } from "./platform.js";

type Tx = Prisma.TransactionClient;
type Root = PrismaClient;

class Halt extends Error {
  constructor(readonly outcome: "unfunded" | "insufficient" | "invalid") {
    super(outcome);
  }
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function money(minor: bigint): string {
  return formatMinor(minor);
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function cardsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((card): card is string => typeof card === "string") : [];
}

function rulesOf(value: unknown): BlackjackRules | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Partial<BlackjackRules>;
  if (typeof row.minBetMarks !== "number" || typeof row.maxBetMarks !== "number" || typeof row.version !== "number") {
    return null;
  }
  if (typeof row.hitSoft17 !== "boolean" || typeof row.naturalNum !== "number" || typeof row.naturalDen !== "number") {
    return null;
  }
  if (typeof row.regularNum !== "number" || typeof row.regularDen !== "number" || typeof row.maxSplits !== "number") {
    return null;
  }
  return prepareBlackjackSettings({
    minBetMarks: row.minBetMarks,
    maxBetMarks: row.maxBetMarks,
    tableCap: row.tableCap ?? BLACKJACK_TABLE_CAP,
    joinSeconds: row.joinSeconds ?? BLACKJACK_JOIN_SECONDS,
    turnSeconds: row.turnSeconds ?? BLACKJACK_TURN_SECONDS,
    decks: row.decks ?? BLACKJACK_DECKS,
    hitSoft17: row.hitSoft17,
    naturalNum: row.naturalNum,
    naturalDen: row.naturalDen,
    regularNum: row.regularNum,
    regularDen: row.regularDen,
    maxSplits: row.maxSplits,
    splitAcesOneCard: row.splitAcesOneCard ?? true,
    splitBlackjackPaysRegular: row.splitBlackjackPaysRegular ?? true,
    version: row.version,
  });
}

async function openEconomy(db: Writer, guildId: string) {
  await ensureGuild(db, { guildId });
  return moduleIsAvailable(db, guildId, "economy");
}

async function ensureSettings(tx: Tx, guildId: string) {
  const seed = defaultBlackjackRules();
  await tx.$executeRaw`
    INSERT INTO "blackjack_settings" (
      "guildId", "minBetMarks", "maxBetMarks", "tableCap", "joinSeconds", "turnSeconds", "decks",
      "hitSoft17", "naturalNum", "naturalDen", "regularNum", "regularDen", "maxSplits",
      "splitAcesOneCard", "splitBlackjackPaysRegular", "version", "updatedAt"
    ) VALUES (
      ${guildId}, ${seed.minBetMarks}, ${seed.maxBetMarks}, ${seed.tableCap}, ${seed.joinSeconds},
      ${seed.turnSeconds}, ${seed.decks}, ${seed.hitSoft17}, ${seed.naturalNum}, ${seed.naturalDen},
      ${seed.regularNum}, ${seed.regularDen}, ${seed.maxSplits}, ${seed.splitAcesOneCard},
      ${seed.splitBlackjackPaysRegular}, ${seed.version}, NOW()
    )
    ON CONFLICT ("guildId") DO NOTHING
  `;
  const settings = await tx.blackjackSettings.findUnique({ where: { guildId } });
  if (!settings) {
    throw new Halt("invalid");
  }
  return settings;
}

function settingsRules(settings: {
  minBetMarks: number;
  maxBetMarks: number;
  tableCap: number;
  joinSeconds: number;
  turnSeconds: number;
  decks: number;
  hitSoft17: boolean;
  naturalNum: number;
  naturalDen: number;
  regularNum: number;
  regularDen: number;
  maxSplits: number;
  splitAcesOneCard: boolean;
  splitBlackjackPaysRegular: boolean;
  version: number;
}): BlackjackRules {
  return {
    minBetMarks: settings.minBetMarks,
    maxBetMarks: settings.maxBetMarks,
    tableCap: settings.tableCap,
    joinSeconds: settings.joinSeconds,
    turnSeconds: settings.turnSeconds,
    decks: settings.decks,
    hitSoft17: settings.hitSoft17,
    naturalNum: settings.naturalNum,
    naturalDen: settings.naturalDen,
    regularNum: settings.regularNum,
    regularDen: settings.regularDen,
    maxSplits: settings.maxSplits,
    splitAcesOneCard: settings.splitAcesOneCard,
    splitBlackjackPaysRegular: settings.splitBlackjackPaysRegular,
    version: settings.version,
  };
}

async function houseWallet(tx: Tx, guildId: string) {
  await tx.$executeRaw`
    INSERT INTO "wallet" ("guildId", "userId", "currency", "availableMinor", "escrowMinor", "updatedAt")
    VALUES (${guildId}, ${BLACKJACK_HOUSE}, 'marks', 0, 0, NOW())
    ON CONFLICT ("guildId", "userId", "currency") DO NOTHING
  `;
  const rows = await tx.$queryRaw<Array<{ availableMinor: bigint | string; escrowMinor: bigint | string }>>`
    SELECT "availableMinor", "escrowMinor" FROM "wallet"
    WHERE "guildId" = ${guildId} AND "userId" = ${BLACKJACK_HOUSE} AND "currency" = 'marks'
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) {
    throw new Halt("invalid");
  }
  return { availableMinor: BigInt(row.availableMinor), escrowMinor: BigInt(row.escrowMinor) };
}

async function lockTable(tx: Tx, tableId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "blackjack_table" WHERE "id" = ${tableId} FOR UPDATE`;
  if (!rows[0]) {
    return null;
  }
  return tx.blackjackTable.findUnique({ where: { id: tableId } });
}

async function spendExceptional(tx: Tx, guildId: string, amount: bigint, now: Date) {
  const period = perthPeriod(now);
  await tx.$executeRaw`
    INSERT INTO "issuance_budget" ("guildId", "scope", "periodKey", "subjectId", "authorizedMinor", "spentMinor", "updatedAt")
    VALUES (${guildId}, 'exceptional', ${period}, 'guild', 0, 0, NOW())
    ON CONFLICT ("guildId", "scope", "periodKey", "subjectId") DO NOTHING
  `;
  const rows = await tx.$queryRaw<Array<{ authorizedMinor: bigint | string; spentMinor: bigint | string }>>`
    SELECT "authorizedMinor", "spentMinor" FROM "issuance_budget"
    WHERE "guildId" = ${guildId} AND "scope" = 'exceptional' AND "periodKey" = ${period} AND "subjectId" = 'guild'
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row || BigInt(row.spentMinor) + amount > BigInt(row.authorizedMinor)) {
    return "unfunded" as const;
  }
  await tx.$executeRaw`
    UPDATE "issuance_budget"
    SET "spentMinor" = "spentMinor" + ${amount}, "updatedAt" = NOW()
    WHERE "guildId" = ${guildId} AND "scope" = 'exceptional' AND "periodKey" = ${period} AND "subjectId" = 'guild'
  `;
  return "ok" as const;
}

function presentQuote(quote: {
  id: string;
  tableId: string;
  mode: string;
  stakeMinor: bigint;
  exposureMinor: bigint;
  naturalProfitMinor: bigint;
  regularProfitMinor: bigint;
  rulesVersion: number;
  rules: unknown;
  expiresAt: Date;
}, bankrollRemaining: bigint) {
  const rules = rulesOf(quote.rules) ?? defaultBlackjackRules(quote.rulesVersion);
  return {
    result: "ready" as const,
    quoteId: quote.id,
    tableId: quote.tableId,
    mode: quote.mode,
    rulesVersion: quote.rulesVersion,
    rules: blackjackRulesText(rules),
    stake: money(quote.stakeMinor),
    naturalProfit: money(quote.naturalProfitMinor),
    regularProfit: money(quote.regularProfitMinor),
    exposure: money(quote.exposureMinor),
    bankrollRemaining: money(bankrollRemaining),
    economy: simulateBlackjackEconomy(),
    expiresAt: quote.expiresAt.toISOString(),
    charged: false as const,
  };
}

async function viewOf(tx: Tx, tableId: string) {
  const table = await tx.blackjackTable.findUnique({ where: { id: tableId } });
  if (!table) {
    return { result: "missing" as const };
  }
  const rules = rulesOf(table.rules) ?? defaultBlackjackRules(table.rulesVersion);
  const reveal = table.status === "settled" || table.status === "cancelled";
  const seats = await tx.blackjackSeat.findMany({ where: { tableId }, orderBy: { seat: "asc" } });
  const hands = await tx.blackjackHand.findMany({ where: { tableId }, orderBy: { position: "asc" } });
  const receipts = await tx.blackjackReceipt.findMany({ where: { tableId }, orderBy: { createdAt: "asc" } });
  return {
    tableId: table.id,
    status: table.status,
    mode: table.mode,
    rulesVersion: table.rulesVersion,
    rules: blackjackRulesText(rules),
    joinUntil: table.joinUntil.toISOString(),
    turnHandId: table.turnHandId,
    turnDeadline: table.turnDeadline?.toISOString() ?? null,
    dealer: presentDealer(cardsOf(table.dealer), reveal),
    seats: seats.map((seat) => ({
      seatId: seat.id,
      userId: seat.userId,
      seat: seat.seat,
      stake: money(seat.stakeMinor),
      exposure: money(seat.exposureMinor),
      profit: money(seat.profitMinor),
      outcome: seat.outcome,
      hands: hands.filter((hand) => hand.seatId === seat.id).map((hand) => ({
        handId: hand.id,
        cards: cardsOf(hand.cards),
        total: handTotal(cardsOf(hand.cards)).total,
        stake: money(hand.stakeMinor),
        profit: money(hand.profitMinor),
        status: hand.status,
        stoodReason: hand.stoodReason,
        fromSplit: hand.fromSplit,
        doubled: hand.doubled,
        outcome: hand.outcome,
      })),
    })),
    receipts: receipts.map((receipt) => ({
      userId: receipt.userId,
      kind: receipt.kind,
      stake: money(receipt.stakeMinor),
      exposure: money(receipt.exposureMinor),
      profit: money(receipt.profitMinor),
      rulesVersion: receipt.rulesVersion,
      summary: receipt.summary,
    })),
  };
}

async function reserveSeat(tx: Tx, input: {
  guildId: string;
  tableId: string;
  userId: string;
  seat: number;
  stakeMinor: bigint;
  exposureMinor: bigint;
  rulesVersion: number;
  now: Date;
}) {
  const seatId = randomUUID();
  const house = await moveHeldCurrency(tx, {
    guildId: input.guildId,
    userId: BLACKJACK_HOUSE,
    currency: "marks",
    availableDelta: -input.exposureMinor,
    escrowDelta: input.exposureMinor,
    kind: "blackjack_reserve",
    direction: "debit",
    amountMinor: input.exposureMinor,
    source: "blackjack",
    sourceId: input.tableId,
    pace: "market",
    idempotencyKey: `blackjack-reserve:${seatId}`,
    reason: "Reserve blackjack split and double exposure",
    actorUserId: input.userId,
    now: input.now,
  });
  if (house === "insufficient") {
    return { result: "unfunded" as const };
  }
  if (house !== "ok") {
    throw new Halt("invalid");
  }
  const player = await moveHeldCurrency(tx, {
    guildId: input.guildId,
    userId: input.userId,
    currency: "marks",
    availableDelta: -input.stakeMinor,
    escrowDelta: input.stakeMinor,
    kind: "blackjack_stake",
    direction: "debit",
    amountMinor: input.stakeMinor,
    source: "blackjack",
    sourceId: input.tableId,
    pace: "market",
    idempotencyKey: `blackjack-stake:${seatId}`,
    reason: "Hold a blackjack stake",
    actorUserId: input.userId,
    now: input.now,
  });
  if (player === "insufficient") {
    throw new Halt("insufficient");
  }
  if (player !== "ok") {
    throw new Halt("invalid");
  }
  await tx.blackjackSeat.create({
    data: {
      id: seatId,
      tableId: input.tableId,
      guildId: input.guildId,
      userId: input.userId,
      seat: input.seat,
      stakeMinor: input.stakeMinor,
      exposureMinor: input.exposureMinor,
      profitMinor: 0n,
      status: "joined",
      outcome: "",
    },
  });
  await tx.blackjackReceipt.create({
    data: {
      id: randomUUID(),
      guildId: input.guildId,
      tableId: input.tableId,
      userId: input.userId,
      kind: "bet",
      stakeMinor: input.stakeMinor,
      exposureMinor: input.exposureMinor,
      profitMinor: 0n,
      rulesVersion: input.rulesVersion,
      summary: `Stake ${money(input.stakeMinor)} reserved ${money(input.exposureMinor)} of house exposure.`,
      idempotencyKey: `blackjack-receipt-bet:${seatId}`,
    },
  });
  return { result: "ok" as const, seatId };
}

async function refundLocked(tx: Tx, table: { id: string; guildId: string; status: string }, now: Date, summary: string) {
  if (table.status === "cancelled" || table.status === "settled") {
    return { result: "already_recorded" as const, ...(await viewOf(tx, table.id)) };
  }
  const seats = await tx.blackjackSeat.findMany({ where: { tableId: table.id }, orderBy: { userId: "asc" } });
  const hands = await tx.blackjackHand.findMany({ where: { tableId: table.id } });
  for (const seat of seats) {
    const owned = hands.filter((hand) => hand.seatId === seat.id);
    const stake = owned.length > 0 ? owned.reduce((sum, hand) => sum + hand.stakeMinor, 0n) : seat.stakeMinor;
    const player = await moveHeldCurrency(tx, {
      guildId: table.guildId,
      userId: seat.userId,
      currency: "marks",
      availableDelta: stake,
      escrowDelta: -stake,
      kind: "blackjack_refund",
      direction: "credit",
      amountMinor: stake,
      source: "blackjack",
      sourceId: table.id,
      pace: "market",
      idempotencyKey: `blackjack-refund:${seat.id}`,
      reason: "Refund an unsettled blackjack stake",
      actorUserId: "system",
      now,
    });
    if (player !== "ok") {
      throw new Halt(player === "insufficient" ? "insufficient" : "invalid");
    }
    const house = await moveHeldCurrency(tx, {
      guildId: table.guildId,
      userId: BLACKJACK_HOUSE,
      currency: "marks",
      availableDelta: seat.exposureMinor,
      escrowDelta: -seat.exposureMinor,
      kind: "blackjack_release",
      direction: "credit",
      amountMinor: seat.exposureMinor,
      source: "blackjack",
      sourceId: table.id,
      pace: "market",
      idempotencyKey: `blackjack-release:${seat.id}`,
      reason: "Release reserved blackjack exposure",
      actorUserId: "system",
      now,
    });
    if (house !== "ok") {
      throw new Halt(house === "insufficient" ? "insufficient" : "invalid");
    }
    await tx.blackjackSeat.update({ where: { id: seat.id }, data: { status: "refunded", outcome: "refund", profitMinor: 0n } });
    await tx.blackjackReceipt.create({
      data: {
        id: randomUUID(),
        guildId: table.guildId,
        tableId: table.id,
        userId: seat.userId,
        kind: "refund",
        stakeMinor: stake,
        exposureMinor: seat.exposureMinor,
        profitMinor: 0n,
        rulesVersion: 0,
        summary,
        idempotencyKey: `blackjack-receipt-refund:${seat.id}`,
      },
    });
    await tx.blackjackNotice.create({
      data: {
        id: randomUUID(),
        guildId: table.guildId,
        tableId: table.id,
        userId: seat.userId,
        kind: "refund",
        status: "setup_required",
        summary: "The refund notice is not posted.",
      },
    });
  }
  await tx.blackjackTable.update({ where: { id: table.id }, data: { status: "cancelled", settledAt: now, turnHandId: "", turnDeadline: null } });
  await writeAudit(tx, {
    guildId: table.guildId,
    actorUserId: "system",
    action: "blackjack.cancel",
    targetType: "blackjack_table",
    targetId: table.id,
    reason: summary,
  });
  return { result: "cancelled" as const, ...(await viewOf(tx, table.id)) };
}

async function settleLocked(tx: Tx, tableId: string, now: Date) {
  const table = await lockTable(tx, tableId);
  if (!table) {
    return { result: "missing" as const };
  }
  if (table.status === "settled" || table.status === "cancelled") {
    return { result: "already_recorded" as const, ...(await viewOf(tx, table.id)) };
  }
  const rules = rulesOf(table.rules);
  if (!rules) {
    return refundLocked(tx, table, now, "System cancellation refunds the unsettled stake.");
  }
  const shoe = cardsOf(table.shoe);
  const drawn = drawDealer({ cards: cardsOf(table.dealer), shoe, cursor: table.cursor, hitSoft17: rules.hitSoft17 });
  if (drawn === "short") {
    return refundLocked(tx, table, now, "System cancellation refunds the unsettled stake.");
  }
  await tx.blackjackTable.update({ where: { id: table.id }, data: { dealer: asJson(drawn.cards), cursor: drawn.cursor } });
  const seats = await tx.blackjackSeat.findMany({ where: { tableId: table.id }, orderBy: { userId: "asc" } });
  const hands = await tx.blackjackHand.findMany({ where: { tableId: table.id }, orderBy: { position: "asc" } });
  for (const seat of seats) {
    const owned = hands.filter((hand) => hand.seatId === seat.id);
    let profit = 0n;
    for (const hand of owned) {
      const payout = handPayout({
        cards: cardsOf(hand.cards),
        stakeMinor: hand.stakeMinor,
        fromSplit: hand.fromSplit,
        dealerCards: drawn.cards,
        rules,
      });
      if (!payout) {
        return refundLocked(tx, table, now, "System cancellation refunds the unsettled stake.");
      }
      profit += payout.profitMinor;
    }
    if (profit > seat.exposureMinor) {
      return refundLocked(tx, table, now, "System cancellation refunds the unsettled stake.");
    }
  }
  for (const seat of seats) {
    const owned = hands.filter((hand) => hand.seatId === seat.id);
    let profit = 0n;
    let stakeBack = 0n;
    let stakeToHouse = 0n;
    const inactive = owned.some((hand) => hand.stoodReason === "inactivity");
    for (const hand of owned) {
      const payout = handPayout({
        cards: cardsOf(hand.cards),
        stakeMinor: hand.stakeMinor,
        fromSplit: hand.fromSplit,
        dealerCards: drawn.cards,
        rules,
      });
      if (!payout) {
        throw new Halt("invalid");
      }
      if (payout.profitMinor > 0n) {
        profit += payout.profitMinor;
        stakeBack += hand.stakeMinor;
      } else if (payout.result === "push") {
        stakeBack += hand.stakeMinor;
      } else {
        stakeToHouse += hand.stakeMinor;
      }
      await tx.blackjackHand.update({
        where: { id: hand.id },
        data: { status: "settled", outcome: payout.result, profitMinor: payout.profitMinor },
      });
    }
    if (profit > seat.exposureMinor) {
      throw new Halt("invalid");
    }
    const player = await moveHeldCurrency(tx, {
      guildId: table.guildId,
      userId: seat.userId,
      currency: "marks",
      availableDelta: stakeBack + profit,
      escrowDelta: -(stakeBack + stakeToHouse),
      kind: profit > 0n ? "blackjack_win" : stakeToHouse > 0n && stakeBack === 0n ? "blackjack_loss" : "blackjack_push",
      direction: stakeBack + profit > 0n ? "credit" : "debit",
      amountMinor: stakeBack + profit > 0n ? stakeBack + profit : stakeToHouse,
      source: "blackjack",
      sourceId: table.id,
      pace: "market",
      idempotencyKey: `blackjack-pay:${seat.id}`,
      reason: "Settle a blackjack hand",
      actorUserId: "system",
      now,
    });
    if (player !== "ok") {
      throw new Halt(player === "insufficient" ? "insufficient" : "invalid");
    }
    const house = await moveHeldCurrency(tx, {
      guildId: table.guildId,
      userId: BLACKJACK_HOUSE,
      currency: "marks",
      availableDelta: seat.exposureMinor - profit + stakeToHouse,
      escrowDelta: -seat.exposureMinor,
      kind: "blackjack_house",
      direction: "credit",
      amountMinor: seat.exposureMinor,
      source: "blackjack",
      sourceId: table.id,
      pace: "market",
      idempotencyKey: `blackjack-house:${seat.id}`,
      reason: "Settle reserved blackjack exposure",
      actorUserId: "system",
      now,
    });
    if (house !== "ok") {
      throw new Halt(house === "insufficient" ? "insufficient" : "invalid");
    }
    const outcome = profit > 0n ? "win" : stakeToHouse > 0n && stakeBack === 0n ? "loss" : "push";
    await tx.blackjackSeat.update({ where: { id: seat.id }, data: { status: "settled", outcome, profitMinor: profit } });
    const summary = inactive
      ? `Stood for inactivity. The hand pays ${money(profit)}.`
      : profit > 0n
        ? `The hand pays ${money(profit)}.`
        : outcome === "push"
          ? "Push returns the stake."
          : "The hand loses the stake.";
    await tx.blackjackReceipt.create({
      data: {
        id: randomUUID(),
        guildId: table.guildId,
        tableId: table.id,
        userId: seat.userId,
        kind: "settle",
        stakeMinor: stakeBack + stakeToHouse,
        exposureMinor: seat.exposureMinor,
        profitMinor: profit,
        rulesVersion: rules.version,
        summary,
        idempotencyKey: `blackjack-receipt-settle:${seat.id}`,
      },
    });
    await tx.blackjackNotice.create({
      data: {
        id: randomUUID(),
        guildId: table.guildId,
        tableId: table.id,
        userId: seat.userId,
        kind: "settle",
        status: "setup_required",
        summary: "The table settled. The notice is not posted.",
      },
    });
  }
  await tx.blackjackTable.update({
    where: { id: table.id },
    data: { status: "settled", settledAt: now, turnHandId: "", turnDeadline: null },
  });
  await writeAudit(tx, {
    guildId: table.guildId,
    actorUserId: "system",
    action: "blackjack.settle",
    targetType: "blackjack_table",
    targetId: table.id,
    reason: "Settle the blackjack table",
  });
  return { result: "settled" as const, ...(await viewOf(tx, table.id)) };
}

async function ensureShoe(tx: Tx, table: { id: string; shoe: unknown; rules: unknown }, random: (max: number) => number, scripted?: readonly string[]) {
  const existing = cardsOf(table.shoe);
  if (existing.length > 0) {
    return existing;
  }
  const rules = rulesOf(table.rules) ?? defaultBlackjackRules();
  const shoe = scripted && scripted.length > 0 ? [...scripted] : shuffleShoe(orderedShoe(rules.decks), random);
  await tx.blackjackTable.update({ where: { id: table.id }, data: { shoe: asJson(shoe) } });
  return shoe;
}

async function dealLocked(tx: Tx, tableId: string, now: Date, random: (max: number) => number, scripted?: readonly string[]) {
  const table = await lockTable(tx, tableId);
  if (!table) {
    return { result: "missing" as const };
  }
  if (table.status === "playing" || table.status === "settled" || table.status === "cancelled") {
    return { result: "already_recorded" as const, ...(await viewOf(tx, table.id)) };
  }
  const rules = rulesOf(table.rules);
  if (!rules) {
    return refundLocked(tx, table, now, "System cancellation refunds the unsettled stake.");
  }
  const seats = await tx.blackjackSeat.findMany({ where: { tableId }, orderBy: { seat: "asc" } });
  if (seats.length === 0) {
    return refundLocked(tx, table, now, "System cancellation refunds the unsettled stake.");
  }
  const shoe = await ensureShoe(tx, table, random, scripted);
  const needed = seats.length * 2 + 2;
  if (shoe.length < needed) {
    return refundLocked(tx, table, now, "System cancellation refunds the unsettled stake.");
  }
  let cursor = 0;
  const dealt = new Map<string, string[]>();
  for (const seat of seats) {
    dealt.set(seat.id, [shoe[cursor] ?? ""]);
    cursor += 1;
  }
  const dealer = [shoe[cursor] ?? ""];
  cursor += 1;
  for (const seat of seats) {
    dealt.get(seat.id)?.push(shoe[cursor] ?? "");
    cursor += 1;
  }
  dealer.push(shoe[cursor] ?? "");
  cursor += 1;
  for (const seat of seats) {
    const cards = (dealt.get(seat.id) ?? []).filter((card) => card !== "");
    const natural = cards.length === 2 && handTotal(cards).total === 21;
    await tx.blackjackHand.create({
      data: {
        id: randomUUID(),
        tableId,
        seatId: seat.id,
        guildId: table.guildId,
        position: 0,
        cards: asJson(cards),
        stakeMinor: seat.stakeMinor,
        status: natural ? "stood" : "playing",
        doubled: false,
        fromSplit: false,
        splitAce: false,
        stoodReason: natural ? "natural" : "",
        outcome: "",
        profitMinor: 0n,
      },
    });
  }
  const dealerNatural = handTotal(dealer).total === 21;
  const seatOrder = seats.map((seat) => seat.id);
  const playingHands = dealerNatural ? [] : await tx.blackjackHand.findMany({ where: { tableId, status: "playing" } });
  playingHands.sort((left, right) => seatOrder.indexOf(left.seatId) - seatOrder.indexOf(right.seatId) || left.position - right.position);
  const playing = playingHands[0] ?? null;
  const deadline = playing ? new Date(now.getTime() + rules.turnSeconds * 1000) : null;
  await tx.blackjackTable.update({
    where: { id: tableId },
    data: {
      status: "playing",
      shoe: asJson(shoe),
      cursor,
      dealer: asJson(dealer),
      turnHandId: playing?.id ?? "",
      turnDeadline: deadline,
    },
  });
  if (!playing) {
    return settleLocked(tx, tableId, now);
  }
  await enqueueJob(tx, {
    guildId: table.guildId,
    jobType: "blackjack.turn",
    payload: { tableId, handId: playing.id, deadline: deadline?.toISOString() ?? "" },
    idempotencyKey: `blackjack-turn:${tableId}:${playing.id}:${deadline?.toISOString() ?? ""}`,
    runAt: deadline ?? now,
  });
  return { result: "playing" as const, ...(await viewOf(tx, tableId)) };
}

async function finishOrTurn(tx: Tx, tableId: string, now: Date) {
  const table = await lockTable(tx, tableId);
  if (!table) {
    return { result: "missing" as const };
  }
  if (table.status !== "playing") {
    return { result: "already_recorded" as const, ...(await viewOf(tx, table.id)) };
  }
  const rules = rulesOf(table.rules) ?? defaultBlackjackRules(table.rulesVersion);
  const seats = await tx.blackjackSeat.findMany({ where: { tableId }, orderBy: { seat: "asc" } });
  const hands = await tx.blackjackHand.findMany({ where: { tableId, status: "playing" } });
  const order = new Map(seats.map((seat) => [seat.id, seat.seat]));
  hands.sort((left, right) => (order.get(left.seatId) ?? 0) - (order.get(right.seatId) ?? 0) || left.position - right.position);
  const next = hands[0];
  if (!next) {
    return settleLocked(tx, tableId, now);
  }
  const deadline = new Date(now.getTime() + rules.turnSeconds * 1000);
  await tx.blackjackTable.update({ where: { id: tableId }, data: { turnHandId: next.id, turnDeadline: deadline } });
  await enqueueJob(tx, {
    guildId: table.guildId,
    jobType: "blackjack.turn",
    payload: { tableId, handId: next.id, deadline: deadline.toISOString() },
    idempotencyKey: `blackjack-turn:${tableId}:${next.id}:${deadline.toISOString()}`,
    runAt: deadline,
  });
  return { result: "playing" as const, ...(await viewOf(tx, tableId)) };
}

function drawCard(shoe: string[], cursor: number): { card: string; cursor: number } | "short" {
  const card = shoe[cursor];
  if (!card) {
    return "short";
  }
  return { card, cursor: cursor + 1 };
}

async function standInactive(tx: Tx, tableId: string, now: Date) {
  const table = await lockTable(tx, tableId);
  if (!table || table.status !== "playing" || !table.turnHandId) {
    return table ? { result: "already_recorded" as const, ...(await viewOf(tx, table.id)) } : { result: "missing" as const };
  }
  const hand = await tx.blackjackHand.findUnique({ where: { id: table.turnHandId } });
  if (!hand || hand.status !== "playing") {
    return finishOrTurn(tx, tableId, now);
  }
  const seat = await tx.blackjackSeat.findUnique({ where: { id: hand.seatId } });
  await tx.blackjackHand.update({ where: { id: hand.id }, data: { status: "stood", stoodReason: "inactivity" } });
  await tx.blackjackAction.create({
    data: {
      id: randomUUID(),
      tableId,
      handId: hand.id,
      guildId: table.guildId,
      userId: seat?.userId ?? "system",
      action: "stand",
      card: "",
      idempotencyKey: `blackjack-inactive:${hand.id}:${table.turnDeadline?.toISOString() ?? ""}`,
    },
  });
  await writeAudit(tx, {
    guildId: table.guildId,
    actorUserId: "system",
    action: "blackjack.inactive",
    targetType: "blackjack_hand",
    targetId: hand.id,
    reason: "Stand an inactive blackjack hand",
  });
  return finishOrTurn(tx, tableId, now);
}

export async function quoteBlackjack(db: Root, input: {
  guildId: string;
  userId: string;
  mode?: string;
  tableId?: string;
  stakeMarks?: number;
  idempotencyKey: string;
  now: Date;
}) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if (!input.idempotencyKey.trim()) {
    return { result: "invalid" as const };
  }
  const prior = await db.blackjackQuote.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (prior) {
    if (prior.status === "accepted") {
      return { result: "already_recorded" as const, quoteId: prior.id, tableId: prior.tableId };
    }
    if (prior.expiresAt <= input.now) {
      return { result: "expired" as const, quoteId: prior.id };
    }
    const house = await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId: input.guildId, userId: BLACKJACK_HOUSE, currency: "marks" } } });
    return presentQuote(prior, house?.availableMinor ?? 0n);
  }
  const mode = input.mode === "social" ? "social" : input.mode === "solo" ? "solo" : "";
  if (!mode && !input.tableId) {
    return { result: "invalid" as const };
  }
  try {
    return await db.$transaction(async (tx) => {
      const settings = await ensureSettings(tx, input.guildId);
      let rules = settingsRules(settings);
      const tableId = input.tableId ?? "";
      let quoteMode = mode || "solo";
      if (tableId) {
        const table = await tx.blackjackTable.findUnique({ where: { id: tableId } });
        if (!table || table.status !== "joining") {
          return { result: "closed" as const };
        }
        const snapshot = rulesOf(table.rules);
        if (!snapshot) {
          throw new Halt("invalid");
        }
        rules = snapshot;
        quoteMode = table.mode;
      } else if (quoteMode === "solo") {
        rules = { ...rules, tableCap: 1, joinSeconds: 0 };
      }
      const stakeMarks = input.stakeMarks ?? rules.minBetMarks;
      const decision = betAllowed(stakeMarks, rules);
      if (decision !== "allowed") {
        return { result: decision };
      }
      const stake = marksStake(stakeMarks) ?? 0n;
      const exposure = worstCaseProfitMinor(stake, rules);
      const natural = exactProfit(stake, rules.naturalNum, rules.naturalDen);
      const regular = exactProfit(stake, rules.regularNum, rules.regularDen);
      if (exposure === null || natural === null || regular === null) {
        return { result: "inexact" as const };
      }
      const house = await houseWallet(tx, input.guildId);
      if (house.availableMinor < exposure) {
        return {
          result: "unfunded" as const,
          rules: blackjackRulesText(rules),
          stake: money(stake),
          exposure: money(exposure),
          bankrollRemaining: money(house.availableMinor),
          charged: false as const,
        };
      }
      const quote = await tx.blackjackQuote.create({
        data: {
          id: randomUUID(),
          guildId: input.guildId,
          userId: input.userId,
          tableId,
          mode: quoteMode,
          stakeMinor: stake,
          exposureMinor: exposure,
          naturalProfitMinor: natural,
          regularProfitMinor: regular,
          rulesVersion: rules.version,
          rules: asJson(rules),
          status: "open",
          idempotencyKey: input.idempotencyKey,
          expiresAt: new Date(input.now.getTime() + 60_000),
        },
      });
      return presentQuote(quote, house.availableMinor);
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    if (isUnique(error)) {
      return { result: "already_recorded" as const };
    }
    throw error;
  }
}

async function acceptQuote(tx: Tx, input: { quoteId: string; userId: string; now: Date; tableId?: string }) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "blackjack_quote" WHERE "id" = ${input.quoteId} FOR UPDATE`;
  if (!rows[0]) {
    return { result: "missing" as const };
  }
  const quote = await tx.blackjackQuote.findUnique({ where: { id: input.quoteId } });
  if (!quote || quote.userId !== input.userId) {
    return { result: "missing" as const };
  }
  if (quote.status === "accepted") {
    return { result: "already_recorded" as const, quote };
  }
  if (quote.expiresAt <= input.now) {
    return { result: "expired" as const, quote };
  }
  if (input.tableId && quote.tableId !== input.tableId) {
    return { result: "stale" as const, quote };
  }
  return { result: "open" as const, quote };
}

export async function openBlackjackTable(db: Root, input: {
  guildId: string;
  userId: string;
  quoteId: string;
  shoe?: readonly string[];
  random?: (max: number) => number;
  now: Date;
}) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  const random = input.random ?? ((max: number) => randomInt(0, max));
  try {
    return await db.$transaction(async (tx) => {
      const accepted = await acceptQuote(tx, { quoteId: input.quoteId, userId: input.userId, now: input.now });
      if (accepted.result === "already_recorded" && accepted.quote) {
        return { result: "already_recorded" as const, ...(await viewOf(tx, accepted.quote.tableId)) };
      }
      if (accepted.result !== "open" || !accepted.quote) {
        return { result: accepted.result };
      }
      const quote = accepted.quote;
      if (quote.tableId) {
        return { result: "invalid" as const };
      }
      const settings = await ensureSettings(tx, input.guildId);
      if (quote.rulesVersion !== settings.version) {
        return { result: "stale" as const };
      }
      const rules = rulesOf(quote.rules);
      if (!rules) {
        throw new Halt("invalid");
      }
      const tableId = randomUUID();
      const joinUntil = quote.mode === "solo" ? input.now : new Date(input.now.getTime() + rules.joinSeconds * 1000);
      await tx.blackjackTable.create({
        data: {
          id: tableId,
          guildId: input.guildId,
          mode: quote.mode,
          status: "joining",
          rulesVersion: rules.version,
          rules: asJson(rules),
          shoe: asJson(input.shoe ?? []),
          cursor: 0,
          dealer: asJson([]),
          joinUntil,
          turnHandId: "",
        },
      });
      const seated = await tx.blackjackSeat.count({ where: { tableId } });
      const reserved = await reserveSeat(tx, {
        guildId: input.guildId,
        tableId,
        userId: input.userId,
        seat: seated,
        stakeMinor: quote.stakeMinor,
        exposureMinor: quote.exposureMinor,
        rulesVersion: rules.version,
        now: input.now,
      });
      if (reserved.result !== "ok") {
        throw new Halt(reserved.result === "unfunded" ? "unfunded" : "insufficient");
      }
      await tx.blackjackQuote.update({ where: { id: quote.id }, data: { status: "accepted", tableId } });
      if (quote.mode === "social") {
        await enqueueJob(tx, {
          guildId: input.guildId,
          jobType: "blackjack.join",
          payload: { tableId },
          idempotencyKey: `blackjack-join:${tableId}`,
          runAt: joinUntil,
        });
      }
      if (quote.mode === "solo" || rules.tableCap <= 1) {
        return dealLocked(tx, tableId, input.now, random, input.shoe);
      }
      return { result: "joining" as const, ...(await viewOf(tx, tableId)) };
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome, charged: false as const };
    }
    if (isUnique(error)) {
      return { result: "already_recorded" as const };
    }
    throw error;
  }
}

export async function joinBlackjackTable(db: Root, input: {
  guildId: string;
  userId: string;
  quoteId: string;
  tableId: string;
  now: Date;
}) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  try {
    return await db.$transaction(async (tx) => {
      const table = await lockTable(tx, input.tableId);
      if (!table || table.guildId !== input.guildId) {
        return { result: "missing" as const };
      }
      if (table.status !== "joining") {
        return { result: "closed" as const, ...(await viewOf(tx, table.id)) };
      }
      if (input.now.getTime() > table.joinUntil.getTime()) {
        return { result: "closed" as const };
      }
      const rules = rulesOf(table.rules);
      if (!rules) {
        throw new Halt("invalid");
      }
      const seats = await tx.blackjackSeat.findMany({ where: { tableId: table.id } });
      if (seats.some((seat) => seat.userId === input.userId)) {
        return { result: "already_recorded" as const, ...(await viewOf(tx, table.id)) };
      }
      if (seats.length >= rules.tableCap) {
        return { result: "full" as const };
      }
      const accepted = await acceptQuote(tx, { quoteId: input.quoteId, userId: input.userId, now: input.now, tableId: table.id });
      if (accepted.result === "already_recorded") {
        return { result: "already_recorded" as const, ...(await viewOf(tx, table.id)) };
      }
      if (accepted.result !== "open" || !accepted.quote) {
        return { result: accepted.result };
      }
      if (accepted.quote.rulesVersion !== table.rulesVersion) {
        return { result: "stale" as const };
      }
      const reserved = await reserveSeat(tx, {
        guildId: input.guildId,
        tableId: table.id,
        userId: input.userId,
        seat: seats.length,
        stakeMinor: accepted.quote.stakeMinor,
        exposureMinor: accepted.quote.exposureMinor,
        rulesVersion: table.rulesVersion,
        now: input.now,
      });
      if (reserved.result !== "ok") {
        return { result: reserved.result, charged: false as const };
      }
      await tx.blackjackQuote.update({ where: { id: accepted.quote.id }, data: { status: "accepted", tableId: table.id } });
      const count = seats.length + 1;
      if (count >= rules.tableCap) {
        return dealLocked(tx, table.id, input.now, (max) => randomInt(0, max));
      }
      return { result: "joining" as const, ...(await viewOf(tx, table.id)) };
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome, charged: false as const };
    }
    if (isUnique(error)) {
      return { result: "already_recorded" as const };
    }
    throw error;
  }
}

export async function closeBlackjackJoin(db: Root, input: { tableId: string; now: Date }) {
  try {
    return await db.$transaction(async (tx) => {
      const table = await lockTable(tx, input.tableId);
      if (!table) {
        return { result: "missing" as const };
      }
      if (table.status !== "joining") {
        return { result: "already_recorded" as const, ...(await viewOf(tx, table.id)) };
      }
      if (input.now.getTime() < table.joinUntil.getTime()) {
        return { result: "open" as const, tableId: table.id };
      }
      return dealLocked(tx, table.id, input.now, (max) => randomInt(0, max));
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    throw error;
  }
}

export async function actBlackjack(db: Root, input: {
  guildId: string;
  userId: string;
  tableId: string;
  action: string;
  idempotencyKey: string;
  now: Date;
}) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if (!input.idempotencyKey.trim()) {
    return { result: "invalid" as const };
  }
  const action = input.action;
  if (action !== "hit" && action !== "stand" && action !== "double" && action !== "split") {
    return { result: "invalid" as const };
  }
  try {
    return await db.$transaction(async (tx) => {
      const table = await lockTable(tx, input.tableId);
      if (!table || table.guildId !== input.guildId) {
        return { result: "missing" as const };
      }
      if (table.status === "settled" || table.status === "cancelled") {
        return { result: "already_recorded" as const, ...(await viewOf(tx, table.id)) };
      }
      if (table.status !== "playing") {
        return { result: "closed" as const };
      }
      const prior = await tx.blackjackAction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (prior) {
        return { result: "already_recorded" as const, card: prior.card, ...(await viewOf(tx, table.id)) };
      }
      if (table.turnDeadline && input.now.getTime() >= table.turnDeadline.getTime()) {
        return standInactive(tx, table.id, input.now);
      }
      const hand = table.turnHandId ? await tx.blackjackHand.findUnique({ where: { id: table.turnHandId } }) : null;
      const seat = hand ? await tx.blackjackSeat.findUnique({ where: { id: hand.seatId } }) : null;
      if (!hand || !seat || seat.userId !== input.userId || hand.status !== "playing") {
        return { result: "turn" as const };
      }
      const rules = rulesOf(table.rules);
      if (!rules) {
        return refundLocked(tx, table, input.now, "System cancellation refunds the unsettled stake.");
      }
      const shoe = cardsOf(table.shoe);
      const cards = cardsOf(hand.cards);
      if (action === "stand") {
        await tx.blackjackHand.update({ where: { id: hand.id }, data: { status: "stood", stoodReason: "player" } });
        await tx.blackjackAction.create({
          data: { id: randomUUID(), tableId: table.id, handId: hand.id, guildId: table.guildId, userId: input.userId, action, card: "", idempotencyKey: input.idempotencyKey },
        });
        return finishOrTurn(tx, table.id, input.now);
      }
      if (action === "double" || action === "split") {
        if (cards.length !== 2 || hand.splitAce) {
          return { result: "invalid" as const };
        }
      }
      if (action === "split") {
        const left = cards[0];
        const right = cards[1];
        if (!left || !right || !sameRank(left, right) || hand.fromSplit || rules.maxSplits < 1) {
          return { result: "invalid" as const };
        }
        const hands = await tx.blackjackHand.count({ where: { seatId: seat.id } });
        if (hands > rules.maxSplits) {
          return { result: "invalid" as const };
        }
        if (drawCard(shoe, table.cursor) === "short" || drawCard(shoe, table.cursor + 1) === "short") {
          return refundLocked(tx, table, input.now, "System cancellation refunds the unsettled stake.");
        }
        const extra = await moveHeldCurrency(tx, {
          guildId: table.guildId,
          userId: input.userId,
          currency: "marks",
          availableDelta: -hand.stakeMinor,
          escrowDelta: hand.stakeMinor,
          kind: "blackjack_split",
          direction: "debit",
          amountMinor: hand.stakeMinor,
          source: "blackjack",
          sourceId: table.id,
          pace: "market",
          idempotencyKey: `blackjack-split:${hand.id}`,
          reason: "Hold the split blackjack stake",
          actorUserId: input.userId,
          now: input.now,
        });
        if (extra === "insufficient") {
          throw new Halt("insufficient");
        }
        if (extra !== "ok") {
          throw new Halt("invalid");
        }
        const first = drawCard(shoe, table.cursor);
        const second = first === "short" ? "short" : drawCard(shoe, first.cursor);
        if (first === "short" || second === "short") {
          throw new Halt("invalid");
        }
        const aces = rules.splitAcesOneCard && sameRank(left, "AS");
        const leftCards = [left, first.card];
        const rightCards = [right, second.card];
        await tx.blackjackHand.update({
          where: { id: hand.id },
          data: {
            cards: asJson(leftCards),
            fromSplit: true,
            splitAce: aces,
            status: aces || handTotal(leftCards).total >= 21 ? "stood" : "playing",
            stoodReason: aces ? "split_ace" : handTotal(leftCards).total >= 21 ? "player" : "",
          },
        });
        await tx.blackjackHand.create({
          data: {
            id: randomUUID(),
            tableId: table.id,
            seatId: seat.id,
            guildId: table.guildId,
            position: 1,
            cards: asJson(rightCards),
            stakeMinor: hand.stakeMinor,
            status: aces || handTotal(rightCards).total >= 21 ? "stood" : "playing",
            doubled: false,
            fromSplit: true,
            splitAce: aces,
            stoodReason: aces ? "split_ace" : handTotal(rightCards).total >= 21 ? "player" : "",
            outcome: "",
            profitMinor: 0n,
          },
        });
        await tx.blackjackTable.update({ where: { id: table.id }, data: { cursor: second.cursor } });
        await tx.blackjackAction.create({
          data: { id: randomUUID(), tableId: table.id, handId: hand.id, guildId: table.guildId, userId: input.userId, action, card: `${first.card},${second.card}`, idempotencyKey: input.idempotencyKey },
        });
        return finishOrTurn(tx, table.id, input.now);
      }
      const drawn = drawCard(shoe, table.cursor);
      if (drawn === "short") {
        return refundLocked(tx, table, input.now, "System cancellation refunds the unsettled stake.");
      }
      if (action === "double") {
        const extra = await moveHeldCurrency(tx, {
          guildId: table.guildId,
          userId: input.userId,
          currency: "marks",
          availableDelta: -hand.stakeMinor,
          escrowDelta: hand.stakeMinor,
          kind: "blackjack_double",
          direction: "debit",
          amountMinor: hand.stakeMinor,
          source: "blackjack",
          sourceId: table.id,
          pace: "market",
          idempotencyKey: `blackjack-double:${hand.id}`,
          reason: "Hold the doubled blackjack stake",
          actorUserId: input.userId,
          now: input.now,
        });
        if (extra === "insufficient") {
          throw new Halt("insufficient");
        }
        if (extra !== "ok") {
          throw new Halt("invalid");
        }
      }
      const nextCards = [...cards, drawn.card];
      const total = handTotal(nextCards).total;
      await tx.blackjackHand.update({
        where: { id: hand.id },
        data: {
          cards: asJson(nextCards),
          stakeMinor: action === "double" ? hand.stakeMinor * 2n : hand.stakeMinor,
          doubled: action === "double" ? true : hand.doubled,
          status: action === "double" || total >= 21 ? "stood" : "playing",
          stoodReason: action === "double" ? "double" : total >= 21 ? "player" : hand.stoodReason,
          ...(total > 21 ? { outcome: "loss" } : {}),
        },
      });
      await tx.blackjackTable.update({ where: { id: table.id }, data: { cursor: drawn.cursor } });
      await tx.blackjackAction.create({
        data: { id: randomUUID(), tableId: table.id, handId: hand.id, guildId: table.guildId, userId: input.userId, action, card: drawn.card, idempotencyKey: input.idempotencyKey },
      });
      if (action === "double" || total >= 21) {
        return finishOrTurn(tx, table.id, input.now);
      }
      const deadline = new Date(input.now.getTime() + rules.turnSeconds * 1000);
      await tx.blackjackTable.update({ where: { id: table.id }, data: { turnDeadline: deadline } });
      await enqueueJob(tx, {
        guildId: table.guildId,
        jobType: "blackjack.turn",
        payload: { tableId: table.id, handId: hand.id, deadline: deadline.toISOString() },
        idempotencyKey: `blackjack-turn:${table.id}:${hand.id}:${deadline.toISOString()}`,
        runAt: deadline,
      });
      return { result: "playing" as const, card: drawn.card, ...(await viewOf(tx, table.id)) };
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome, charged: false as const };
    }
    if (isUnique(error)) {
      return { result: "already_recorded" as const };
    }
    throw error;
  }
}

export async function expireBlackjackTurn(db: Root, input: { tableId: string; handId?: string; deadline?: string; now: Date }) {
  try {
    return await db.$transaction(async (tx) => {
      const table = await lockTable(tx, input.tableId);
      if (!table || table.status !== "playing" || !table.turnDeadline) {
        return table ? { result: "already_recorded" as const, ...(await viewOf(tx, table.id)) } : { result: "missing" as const };
      }
      if (input.handId && table.turnHandId !== input.handId) {
        return { result: "open" as const, tableId: table.id };
      }
      if (input.deadline && table.turnDeadline.toISOString() !== input.deadline) {
        return { result: "open" as const, tableId: table.id };
      }
      if (input.now.getTime() < table.turnDeadline.getTime()) {
        return { result: "open" as const, tableId: table.id };
      }
      return standInactive(tx, table.id, input.now);
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    throw error;
  }
}

export async function sweepBlackjack(db: Root, now: Date) {
  const joining = await db.blackjackTable.findMany({ where: { status: "joining", joinUntil: { lte: now } } });
  const playing = await db.blackjackTable.findMany({ where: { status: "playing", turnDeadline: { lte: now } } });
  const results = [];
  for (const table of joining) {
    results.push(await closeBlackjackJoin(db, { tableId: table.id, now }));
  }
  for (const table of playing) {
    results.push(await expireBlackjackTurn(db, { tableId: table.id, now }));
  }
  return results;
}

export async function cancelBlackjack(db: Root, input: {
  guildId: string;
  actorUserId: string;
  actorRoleIds: readonly string[];
  tableId: string;
  reason: string;
  now: Date;
}) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "economy_operations" })) !== "allowed") {
    return { result: "denied" as const };
  }
  if (!input.reason.trim()) {
    return { result: "invalid" as const };
  }
  try {
    return await db.$transaction(async (tx) => {
      const table = await lockTable(tx, input.tableId);
      if (!table || table.guildId !== input.guildId) {
        return { result: "missing" as const };
      }
      return refundLocked(tx, table, input.now, input.reason.trim());
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    throw error;
  }
}

export async function saveBlackjackSettings(db: Root, input: {
  guildId: string;
  actorUserId: string;
  actorRoleIds: readonly string[];
  now: Date;
  minBetMarks?: number;
  maxBetMarks?: number;
  tableCap?: number;
  joinSeconds?: number;
  turnSeconds?: number;
  decks?: number;
  hitSoft17?: boolean;
  naturalNum?: number;
  naturalDen?: number;
  regularNum?: number;
  regularDen?: number;
  maxSplits?: number;
  splitAcesOneCard?: boolean;
  splitBlackjackPaysRegular?: boolean;
}) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "economy_operations" })) !== "allowed") {
    return { result: "denied" as const };
  }
  return db.$transaction(async (tx) => {
    const current = settingsRules(await ensureSettings(tx, input.guildId));
    const next = prepareBlackjackSettings({
      ...current,
      ...(input.minBetMarks !== undefined ? { minBetMarks: input.minBetMarks } : {}),
      ...(input.maxBetMarks !== undefined ? { maxBetMarks: input.maxBetMarks } : {}),
      ...(input.tableCap !== undefined ? { tableCap: input.tableCap } : {}),
      ...(input.joinSeconds !== undefined ? { joinSeconds: input.joinSeconds } : {}),
      ...(input.turnSeconds !== undefined ? { turnSeconds: input.turnSeconds } : {}),
      ...(input.decks !== undefined ? { decks: input.decks } : {}),
      ...(input.hitSoft17 !== undefined ? { hitSoft17: input.hitSoft17 } : {}),
      ...(input.naturalNum !== undefined ? { naturalNum: input.naturalNum } : {}),
      ...(input.naturalDen !== undefined ? { naturalDen: input.naturalDen } : {}),
      ...(input.regularNum !== undefined ? { regularNum: input.regularNum } : {}),
      ...(input.regularDen !== undefined ? { regularDen: input.regularDen } : {}),
      ...(input.maxSplits !== undefined ? { maxSplits: input.maxSplits } : {}),
      ...(input.splitAcesOneCard !== undefined ? { splitAcesOneCard: input.splitAcesOneCard } : {}),
      ...(input.splitBlackjackPaysRegular !== undefined ? { splitBlackjackPaysRegular: input.splitBlackjackPaysRegular } : {}),
      version: current.version + 1,
    });
    if (!next) {
      return { result: "invalid" as const };
    }
    await tx.blackjackSettings.update({
      where: { guildId: input.guildId },
      data: { ...next },
    });
    await writeAudit(tx, {
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      action: "blackjack.settings",
      targetType: "blackjack_settings",
      targetId: input.guildId,
      reason: "Save blackjack table rules",
    });
    return { result: "saved" as const, rulesVersion: next.version, hitSoft17: next.hitSoft17, rules: blackjackRulesText(next) };
  });
}

export async function fundBlackjackBankroll(db: Root, input: {
  guildId: string;
  actorUserId: string;
  actorRoleIds: readonly string[];
  amountMarks: number;
  idempotencyKey: string;
  reason: string;
  now: Date;
}) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "economy_operations" })) !== "allowed") {
    return { result: "denied" as const };
  }
  const amount = marksStake(input.amountMarks);
  if (amount === null || amount <= 0n || !input.idempotencyKey.trim() || !input.reason.trim()) {
    return { result: "invalid" as const };
  }
  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        return { result: "already_recorded" as const };
      }
      const funded = await spendExceptional(tx, input.guildId, amount, input.now);
      if (funded !== "ok") {
        return { result: "unfunded" as const };
      }
      const moved = await moveHeldCurrency(tx, {
        guildId: input.guildId,
        userId: BLACKJACK_HOUSE,
        currency: "marks",
        availableDelta: amount,
        escrowDelta: 0n,
        kind: "issue",
        direction: "credit",
        amountMinor: amount,
        source: "blackjack",
        sourceId: input.guildId,
        pace: "exceptional",
        idempotencyKey: input.idempotencyKey,
        reason: input.reason.trim(),
        actorUserId: input.actorUserId,
        now: input.now,
      });
      if (moved !== "ok") {
        throw new Halt("invalid");
      }
      await writeAudit(tx, {
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        action: "blackjack.fund",
        targetType: "wallet",
        targetId: BLACKJACK_HOUSE,
        reason: input.reason.trim(),
      });
      const house = await houseWallet(tx, input.guildId);
      return { result: "funded" as const, amount: money(amount), available: money(house.availableMinor) };
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    if (isUnique(error)) {
      return { result: "already_recorded" as const };
    }
    throw error;
  }
}

export async function readBlackjack(db: Writer, input: { guildId: string; userId: string }) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  return db.$transaction(async (tx) => {
    const settings = settingsRules(await ensureSettings(tx, input.guildId));
    const house = await tx.wallet.findUnique({ where: { guildId_userId_currency: { guildId: input.guildId, userId: BLACKJACK_HOUSE, currency: "marks" } } });
    const seats = await tx.blackjackSeat.findMany({ where: { guildId: input.guildId, userId: input.userId }, take: 10 });
    const tables = [];
    for (const seat of seats) {
      tables.push(await viewOf(tx, seat.tableId));
    }
    return {
      result: "ready" as const,
      rules: blackjackRulesText(settings),
      rulesVersion: settings.version,
      bankrollRemaining: money(house?.availableMinor ?? 0n),
      economy: simulateBlackjackEconomy(),
      tables,
    };
  });
}

export async function readBlackjackStaff(db: Writer, guildId: string) {
  if (!(await openEconomy(db, guildId))) {
    return { result: "maintenance" as const };
  }
  return db.$transaction(async (tx) => {
    const settings = settingsRules(await ensureSettings(tx, guildId));
    const house = await tx.wallet.findUnique({ where: { guildId_userId_currency: { guildId, userId: BLACKJACK_HOUSE, currency: "marks" } } });
    const open = await tx.blackjackTable.findMany({ where: { guildId, status: { in: ["joining", "playing"] } }, take: 20 });
    const tables = [];
    for (const table of open) {
      tables.push(await viewOf(tx, table.id));
    }
    return {
      result: "ready" as const,
      rules: blackjackRulesText(settings),
      rulesVersion: settings.version,
      hitSoft17: settings.hitSoft17,
      minBetMarks: settings.minBetMarks,
      maxBetMarks: settings.maxBetMarks,
      tableCap: settings.tableCap,
      bankrollAvailable: money(house?.availableMinor ?? 0n),
      bankrollReserved: money(house?.escrowMinor ?? 0n),
      economy: simulateBlackjackEconomy(),
      tables,
    };
  });
}
