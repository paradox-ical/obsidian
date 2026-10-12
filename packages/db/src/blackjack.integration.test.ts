import { randomUUID } from "node:crypto";

import { BLACKJACK_HOUSE } from "@collective/domain";
import { afterAll, describe, expect, it } from "vitest";

import {
  actBlackjack,
  cancelBlackjack,
  expireBlackjackTurn,
  fundBlackjackBankroll,
  joinBlackjackTable,
  openBlackjackTable,
  quoteBlackjack,
  saveBlackjackSettings,
  sweepBlackjack,
} from "./blackjack.js";
import { createPrismaClient } from "./client.js";
import { fundExceptional, issueMarks } from "./ledger.js";
import { grantCapability } from "./platform.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const now = new Date("2026-10-12T02:00:00.000Z");
const staff = ["staff"];

async function wallet(userId: string) {
  const row = await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId, userId, currency: "marks" } } });
  return { available: row?.availableMinor ?? 0n, escrow: row?.escrowMinor ?? 0n };
}

function idOf(value: { result: string }, key: "quoteId" | "tableId"): string {
  if (!(key in value) || typeof value[key as keyof typeof value] !== "string") {
    throw new Error(value.result);
  }
  return String(value[key as keyof typeof value]);
}

afterAll(async () => {
  await db.blackjackAction.deleteMany({ where: { guildId } });
  await db.blackjackNotice.deleteMany({ where: { guildId } });
  await db.blackjackReceipt.deleteMany({ where: { guildId } });
  await db.blackjackHand.deleteMany({ where: { guildId } });
  await db.blackjackQuote.deleteMany({ where: { guildId } });
  await db.blackjackSeat.deleteMany({ where: { guildId } });
  await db.blackjackTable.deleteMany({ where: { guildId } });
  await db.blackjackSettings.deleteMany({ where: { guildId } });
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

describe("solo and social blackjack", () => {
  it("reserves split and double exposure, keeps stored cards, and pays exact minor units", async () => {
    await grantCapability(db, { guildId, roleId: "staff", capability: "economy_operations", actorUserId: "owner", reason: "Blackjack test" });
    expect(await saveBlackjackSettings(db, { guildId, actorUserId: "owner", actorRoleIds: [], hitSoft17: true, now })).toMatchObject({ result: "denied" });
    expect(await fundExceptional(db, { guildId, amountMarks: 20000, idempotencyKey: "bj-pool", reason: "Blackjack test", actorUserId: "owner", actorRoleIds: staff, now })).toMatchObject({ result: "funded" });
    for (const userId of ["alpha", "beta", "gamma"]) {
      expect(await issueMarks(db, { guildId, userId, amountMarks: 1000, source: "blackjack.test", sourceId: userId, pace: "exceptional", idempotencyKey: `bj-fund:${userId}`, reason: "Blackjack test", actorUserId: "owner", now })).toMatchObject({ result: "posted" });
    }

    const before = await wallet("alpha");
    const early = await quoteBlackjack(db, { guildId, userId: "alpha", mode: "solo", stakeMarks: 1, idempotencyKey: "quote-early", now });
    expect(early).toMatchObject({ result: "unfunded", charged: false });
    expect(await wallet("alpha")).toEqual(before);
    expect(await fundBlackjackBankroll(db, { guildId, amountMarks: 3, idempotencyKey: "bank-short", reason: "Short bankroll", actorUserId: "owner", actorRoleIds: staff, now })).toMatchObject({ result: "funded" });
    expect(await fundBlackjackBankroll(db, { guildId, amountMarks: 3, idempotencyKey: "bank-short", reason: "Short bankroll", actorUserId: "owner", actorRoleIds: staff, now })).toMatchObject({ result: "already_recorded" });
    expect(await quoteBlackjack(db, { guildId, userId: "alpha", mode: "social", stakeMarks: 1, idempotencyKey: "quote-short", now })).toMatchObject({ result: "unfunded", charged: false });
    expect(await wallet("alpha")).toEqual(before);

    expect(await fundBlackjackBankroll(db, { guildId, amountMarks: 1, idempotencyKey: "bank-one", reason: "One worst-case bet", actorUserId: "owner", actorRoleIds: staff, now })).toMatchObject({ result: "funded" });
    const heldQuote = await quoteBlackjack(db, { guildId, userId: "alpha", mode: "social", stakeMarks: 1, idempotencyKey: "quote-hold", now });
    expect(heldQuote).toMatchObject({ result: "ready", exposure: "4.00", naturalProfit: "1.50", charged: false });
    expect(heldQuote).toMatchObject({ economy: { worstPlayerLossMarks: 40, smallRelativeToSlowEconomy: true, monthlyRoutineMarks: 7987 } });
    const held = await openBlackjackTable(db, { guildId, userId: "alpha", quoteId: idOf(heldQuote, "quoteId"), now });
    expect(held).toMatchObject({ result: "joining" });
    expect(await wallet("alpha")).toEqual({ available: before.available - 100n, escrow: 100n });
    expect(await wallet(BLACKJACK_HOUSE)).toEqual({ available: 0n, escrow: 400n });
    const betaBefore = await wallet("beta");
    expect(await quoteBlackjack(db, { guildId, userId: "beta", mode: "social", tableId: idOf(held, "tableId"), stakeMarks: 1, idempotencyKey: "quote-beta-short", now })).toMatchObject({ result: "unfunded" });
    expect(await wallet("beta")).toEqual(betaBefore);
    expect(await cancelBlackjack(db, { guildId, actorUserId: "owner", actorRoleIds: staff, tableId: idOf(held, "tableId"), reason: " ", now })).toMatchObject({ result: "invalid" });
    expect(await wallet("alpha")).toEqual({ available: before.available - 100n, escrow: 100n });
    expect(await cancelBlackjack(db, { guildId, actorUserId: "owner", actorRoleIds: staff, tableId: idOf(held, "tableId"), reason: "System cancellation refunds the unsettled stake", now })).toMatchObject({ result: "cancelled" });
    expect(await cancelBlackjack(db, { guildId, actorUserId: "owner", actorRoleIds: staff, tableId: idOf(held, "tableId"), reason: "System cancellation refunds the unsettled stake", now })).toMatchObject({ result: "already_recorded" });
    expect(await wallet("alpha")).toEqual(before);
    expect(await wallet(BLACKJACK_HOUSE)).toEqual({ available: 400n, escrow: 0n });

    expect(await fundBlackjackBankroll(db, { guildId, amountMarks: 1000, idempotencyKey: "bank-rest", reason: "Fund the house bankroll", actorUserId: "owner", actorRoleIds: staff, now })).toMatchObject({ result: "funded" });
    const issues = await db.ledgerEntry.count({ where: { guildId, kind: "issue" } });
    expect(await saveBlackjackSettings(db, { guildId, actorUserId: "owner", actorRoleIds: staff, tableCap: 2, now })).toMatchObject({ result: "saved", rulesVersion: 2 });

    const hostQuote = await quoteBlackjack(db, { guildId, userId: "alpha", mode: "social", stakeMarks: 1, idempotencyKey: "quote-host", now });
    const host = await openBlackjackTable(db, {
      guildId,
      userId: "alpha",
      quoteId: idOf(hostQuote, "quoteId"),
      shoe: ["9S", "10H", "8D", "8C", "QS", "7C", "10D"],
      now,
    });
    const socialId = idOf(host, "tableId");
    const betaQuote = await quoteBlackjack(db, { guildId, userId: "beta", tableId: socialId, stakeMarks: 1, idempotencyKey: "quote-beta", now });
    const gammaQuote = await quoteBlackjack(db, { guildId, userId: "gamma", tableId: socialId, stakeMarks: 1, idempotencyKey: "quote-gamma", now });
    const gammaStart = await wallet("gamma");
    const betaStart = await wallet("beta");
    const [left, right] = await Promise.all([
      joinBlackjackTable(db, { guildId, userId: "beta", quoteId: idOf(betaQuote, "quoteId"), tableId: socialId, now }),
      joinBlackjackTable(db, { guildId, userId: "gamma", quoteId: idOf(gammaQuote, "quoteId"), tableId: socialId, now }),
    ]);
    expect([left.result, right.result].sort()).toEqual(["closed", "playing"]);
    expect(await db.blackjackSeat.count({ where: { tableId: socialId } })).toBe(2);
    const betaEnd = await wallet("beta");
    const gammaEnd = await wallet("gamma");
    const charged = [
      betaEnd.available === betaStart.available - 100n && betaEnd.escrow === 100n,
      gammaEnd.available === gammaStart.available - 100n && gammaEnd.escrow === 100n,
    ].filter(Boolean);
    expect(charged).toHaveLength(1);
    expect(await cancelBlackjack(db, { guildId, actorUserId: "owner", actorRoleIds: staff, tableId: socialId, reason: "Close the unfinished race table", now })).toMatchObject({ result: "cancelled" });
    expect(await wallet("beta")).toEqual(betaStart);
    expect(await wallet("gamma")).toEqual(gammaStart);

    const naturalQuote = await quoteBlackjack(db, { guildId, userId: "alpha", mode: "solo", stakeMarks: 1, idempotencyKey: "quote-natural", now });
    expect(JSON.stringify(naturalQuote)).toContain("Dealer stands on soft 17");
    const natural = await openBlackjackTable(db, { guildId, userId: "alpha", quoteId: idOf(naturalQuote, "quoteId"), shoe: ["AS", "10H", "KS", "7D"], now });
    expect(natural).toMatchObject({ result: "settled" });
    const naturalAgain = await openBlackjackTable(db, { guildId, userId: "alpha", quoteId: idOf(naturalQuote, "quoteId"), shoe: ["AS", "10H", "KS", "7D"], now });
    expect(naturalAgain).toMatchObject({ result: "already_recorded" });
    const naturalSeat = "seats" in natural ? natural.seats[0] : undefined;
    expect(naturalSeat?.hands[0]?.cards).toEqual(["AS", "KS"]);
    expect(naturalSeat?.profit).toBe("1.50");
    expect(naturalSeat?.hands[0]?.profit).toBe("1.50");
    const afterNatural = await wallet("alpha");
    expect(await sweepBlackjack(db, new Date(now.getTime() + 3_600_000))).toEqual(expect.any(Array));
    expect(await wallet("alpha")).toEqual(afterNatural);

    const pushQuote = await quoteBlackjack(db, { guildId, userId: "alpha", mode: "solo", stakeMarks: 1, idempotencyKey: "quote-push", now });
    const pushStart = await wallet("alpha");
    const pushed = await openBlackjackTable(db, { guildId, userId: "alpha", quoteId: idOf(pushQuote, "quoteId"), shoe: ["AS", "AD", "KS", "KH"], now });
    expect(pushed).toMatchObject({ result: "settled" });
    expect("seats" in pushed ? pushed.seats[0]?.profit : "").toBe("0.00");
    expect("seats" in pushed ? pushed.seats[0]?.outcome : "").toBe("push");
    expect(await wallet("alpha")).toEqual(pushStart);

    const splitQuote = await quoteBlackjack(db, { guildId, userId: "alpha", mode: "solo", stakeMarks: 1, idempotencyKey: "quote-split", now });
    const split = await openBlackjackTable(db, { guildId, userId: "alpha", quoteId: idOf(splitQuote, "quoteId"), shoe: ["AS", "KH", "AD", "QC", "KS", "9D"], now });
    expect(split).toMatchObject({ result: "playing" });
    const splitAct = await actBlackjack(db, { guildId, userId: "alpha", tableId: idOf(split, "tableId"), action: "split", idempotencyKey: "split-1", now });
    expect(splitAct).toMatchObject({ result: "settled" });
    const splitHands = "seats" in splitAct ? splitAct.seats?.[0]?.hands ?? [] : [];
    expect(splitHands.map((hand) => hand.profit)).toEqual(["1.00", "0.00"]);
    expect(splitHands.every((hand) => hand.fromSplit)).toBe(true);
    expect(splitHands.some((hand) => hand.profit === "1.50")).toBe(false);

    const softQuote = await quoteBlackjack(db, { guildId, userId: "alpha", mode: "solo", stakeMarks: 1, idempotencyKey: "quote-soft", now });
    const soft = await openBlackjackTable(db, { guildId, userId: "alpha", quoteId: idOf(softQuote, "quoteId"), shoe: ["10S", "AH", "7D", "6C", "5H", "KH"], now });
    expect(JSON.stringify(soft)).not.toContain("6C");
    expect(JSON.stringify(soft)).not.toContain("5H");
    expect(JSON.stringify(soft)).not.toContain("KH");
    const softRow = await db.blackjackTable.findUniqueOrThrow({ where: { id: idOf(soft, "tableId") } });
    expect(softRow.dealer).toEqual(["AH", "6C"]);
    expect(softRow.shoe).toEqual(["10S", "AH", "7D", "6C", "5H", "KH"]);
    const stood = await actBlackjack(db, { guildId, userId: "alpha", tableId: softRow.id, action: "stand", idempotencyKey: "soft-stand", now });
    expect(stood).toMatchObject({ result: "settled" });
    expect("seats" in stood ? stood.seats?.[0]?.profit : "").toBe("0.00");
    const stoodRow = await db.blackjackTable.findUniqueOrThrow({ where: { id: softRow.id } });
    expect(stoodRow.cursor).toBe(4);
    expect(stoodRow.dealer).toEqual(["AH", "6C"]);
    expect(stoodRow.rules).toMatchObject({ hitSoft17: false });

    expect(await saveBlackjackSettings(db, { guildId, actorUserId: "owner", actorRoleIds: staff, hitSoft17: true, now })).toMatchObject({ result: "saved", hitSoft17: true });
    const hitSoftQuote = await quoteBlackjack(db, { guildId, userId: "alpha", mode: "solo", stakeMarks: 1, idempotencyKey: "quote-soft-hit", now });
    expect(JSON.stringify(hitSoftQuote)).toContain("Dealer hits soft 17");
    const hitSoft = await openBlackjackTable(db, { guildId, userId: "alpha", quoteId: idOf(hitSoftQuote, "quoteId"), shoe: ["10S", "AH", "7D", "6C", "5H", "KH"], now });
    const hitSoftStood = await actBlackjack(db, { guildId, userId: "alpha", tableId: idOf(hitSoft, "tableId"), action: "stand", idempotencyKey: "soft-hit-stand", now });
    expect("seats" in hitSoftStood ? hitSoftStood.seats?.[0]?.profit : "").toBe("1.00");
    const hitSoftRow = await db.blackjackTable.findUniqueOrThrow({ where: { id: idOf(hitSoft, "tableId") } });
    expect(hitSoftRow.cursor).toBe(6);
    expect(hitSoftRow.dealer).toEqual(["AH", "6C", "5H", "KH"]);
    expect(hitSoftRow.rules).toMatchObject({ hitSoft17: true });
    expect((await db.blackjackTable.findUniqueOrThrow({ where: { id: softRow.id } })).rules).toMatchObject({ hitSoft17: false });

    const quietQuote = await quoteBlackjack(db, { guildId, userId: "alpha", mode: "solo", stakeMarks: 1, idempotencyKey: "quote-quiet", now });
    const quiet = await openBlackjackTable(db, { guildId, userId: "alpha", quoteId: idOf(quietQuote, "quoteId"), shoe: ["10S", "9H", "QS", "8D"], now });
    const deadline = "turnDeadline" in quiet && quiet.turnDeadline ? new Date(quiet.turnDeadline) : null;
    if (!deadline) {
      throw new Error("missing deadline");
    }
    expect(await expireBlackjackTurn(db, { tableId: idOf(quiet, "tableId"), now: new Date(deadline.getTime() - 1) })).toMatchObject({ result: "open" });
    const inactive = await expireBlackjackTurn(db, { tableId: idOf(quiet, "tableId"), now: deadline });
    expect(inactive).toMatchObject({ result: "settled" });
    expect("seats" in inactive ? inactive.seats?.[0]?.hands[0]?.cards : []).toEqual(["10S", "QS"]);
    expect("seats" in inactive ? inactive.seats?.[0]?.hands[0]?.stoodReason : "").toBe("inactivity");
    expect("seats" in inactive ? inactive.seats?.[0]?.profit : "").toBe("1.00");
    expect("status" in inactive ? inactive.status : "").not.toBe("cancelled");
    const quietReceipt = await db.blackjackReceipt.findFirstOrThrow({ where: { tableId: idOf(quiet, "tableId"), kind: "settle" } });
    expect(quietReceipt.summary).toContain("Stood for inactivity");
    expect(quietReceipt.summary).toContain("1.00");
    const quietNotice = await db.blackjackNotice.findFirstOrThrow({ where: { tableId: idOf(quiet, "tableId") } });
    expect(quietNotice.status).toBe("setup_required");
    expect(Object.hasOwn(quietNotice, "messageId")).toBe(false);

    const doubleQuote = await quoteBlackjack(db, { guildId, userId: "alpha", mode: "solo", stakeMarks: 1, idempotencyKey: "quote-double", now });
    const doubleStart = await wallet(BLACKJACK_HOUSE);
    const doubled = await openBlackjackTable(db, { guildId, userId: "alpha", quoteId: idOf(doubleQuote, "quoteId"), shoe: ["5S", "9H", "4D", "8C", "10S"], now });
    expect(await wallet(BLACKJACK_HOUSE)).toEqual({ available: doubleStart.available - 400n, escrow: doubleStart.escrow + 400n });
    const doubleAct = await actBlackjack(db, { guildId, userId: "alpha", tableId: idOf(doubled, "tableId"), action: "double", idempotencyKey: "double-1", now });
    expect(doubleAct).toMatchObject({ result: "settled" });
    expect("seats" in doubleAct ? doubleAct.seats?.[0]?.exposure : "").toBe("4.00");
    expect("seats" in doubleAct ? doubleAct.seats?.[0]?.profit : "").toBe("2.00");
    expect(await db.ledgerEntry.count({ where: { guildId, kind: "blackjack_double", sourceId: idOf(doubled, "tableId") } })).toBe(1);
    expect(await actBlackjack(db, { guildId, userId: "alpha", tableId: idOf(doubled, "tableId"), action: "double", idempotencyKey: "double-1", now })).toMatchObject({ result: "already_recorded" });
    expect(await db.ledgerEntry.count({ where: { guildId, kind: "blackjack_double", sourceId: idOf(doubled, "tableId") } })).toBe(1);
    expect(await wallet(BLACKJACK_HOUSE)).toEqual({ available: doubleStart.available - 200n, escrow: doubleStart.escrow });

    const hitQuote = await quoteBlackjack(db, { guildId, userId: "alpha", mode: "solo", stakeMarks: 1, idempotencyKey: "quote-hit", now });
    const hit = await openBlackjackTable(db, { guildId, userId: "alpha", quoteId: idOf(hitQuote, "quoteId"), shoe: ["8S", "9H", "2D", "7C", "5S", "3D", "KH"], now });
    const hitId = idOf(hit, "tableId");
    const firstHit = await actBlackjack(db, { guildId, userId: "alpha", tableId: hitId, action: "hit", idempotencyKey: "hit-1", now });
    expect("seats" in firstHit ? firstHit.seats?.[0]?.hands[0]?.cards : []).toEqual(["8S", "2D", "5S"]);
    expect(JSON.stringify(firstHit)).not.toContain("7C");
    expect(JSON.stringify(firstHit)).not.toContain("3D");
    const cursor = (await db.blackjackTable.findUniqueOrThrow({ where: { id: hitId } })).cursor;
    const replay = await actBlackjack(db, { guildId, userId: "alpha", tableId: hitId, action: "hit", idempotencyKey: "hit-1", now });
    expect(replay).toMatchObject({ result: "already_recorded" });
    expect("seats" in replay ? replay.seats?.[0]?.hands[0]?.cards : []).toEqual(["8S", "2D", "5S"]);
    expect((await db.blackjackTable.findUniqueOrThrow({ where: { id: hitId } })).cursor).toBe(cursor);
    const secondHit = await actBlackjack(db, { guildId, userId: "alpha", tableId: hitId, action: "hit", idempotencyKey: "hit-2", now });
    expect("seats" in secondHit ? secondHit.seats?.[0]?.hands[0]?.cards : []).toEqual(["8S", "2D", "5S", "3D"]);
    const hitWallet = await wallet("alpha");
    const finished = await actBlackjack(db, { guildId, userId: "alpha", tableId: hitId, action: "stand", idempotencyKey: "hit-stand", now });
    expect(finished).toMatchObject({ result: "settled" });
    expect("seats" in finished ? finished.seats?.[0]?.profit : "").toBe("1.00");
    const recovered = await actBlackjack(db, { guildId, userId: "alpha", tableId: hitId, action: "stand", idempotencyKey: "hit-stand-again", now });
    expect(recovered).toMatchObject({ result: "already_recorded" });
    expect(await wallet("alpha")).toEqual({ available: hitWallet.available + 200n, escrow: hitWallet.escrow - 100n });
    expect((await db.blackjackTable.findUniqueOrThrow({ where: { id: hitId } })).shoe).toEqual(["8S", "9H", "2D", "7C", "5S", "3D", "KH"]);
    const lossQuote = await quoteBlackjack(db, { guildId, userId: "alpha", mode: "solo", stakeMarks: 1, idempotencyKey: "quote-loss", now });
    const lossStart = await wallet("alpha");
    const loss = await openBlackjackTable(db, { guildId, userId: "alpha", quoteId: idOf(lossQuote, "quoteId"), shoe: ["10S", "AS", "9D", "KS"], now });
    expect(loss).toMatchObject({ result: "settled" });
    expect("seats" in loss ? loss.seats[0]?.hands[0]?.cards : []).toHaveLength(2);
    expect(await wallet("alpha")).toEqual({ available: lossStart.available - 100n, escrow: lossStart.escrow });
    expect(await db.ledgerEntry.count({ where: { guildId, kind: "issue" } })).toBe(issues);
  }, 60_000);
});
