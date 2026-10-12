import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";
import {
  buyPick,
  cancelDeadDrop,
  closeDeadDrop,
  fundDeadDropBudget,
  inspectDeadDrop,
  pauseDeadDrop,
  quotePick,
  readBoard,
  readDeadDropHistory,
  readDeadDropStaff,
  resumeDeadDrop,
  saveDeadDropSettings,
  saveDeadDropSpecial,
  setDeadDropReminder,
  sweepDeadDrop,
} from "./dead-drop.js";
import { fundExceptional, issueMarks } from "./ledger.js";
import { activateCollapseCharge, allocateEventTreasury, readMarketDiagnostics, releaseProtectedReserve } from "./market.js";
import { grantCapability } from "./platform.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const now = new Date("2026-10-12T02:00:00.000Z");
const closesAt = new Date("2026-10-12T03:00:00.000Z");
const nextOpen = new Date("2026-10-13T02:00:00.000Z");
const day3Open = new Date("2026-10-14T02:00:00.000Z");
const staff = ["staff"];

async function wallet(userId: string) {
  const row = await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId, userId, currency: "marks" } } });
  return { available: row?.availableMinor ?? 0n, escrow: row?.escrowMinor ?? 0n };
}

afterAll(async () => {
  await db.deadDropNotice.deleteMany({ where: { guildId } });
  await db.deadDropReminder.deleteMany({ where: { guildId } });
  await db.deadDropPost.deleteMany({ where: { guildId } });
  await db.deadDropQuote.deleteMany({ where: { guildId } });
  await db.deadDropPick.deleteMany({ where: { guildId } });
  await db.deadDropCell.deleteMany({ where: { guildId } });
  await db.deadDropBoard.deleteMany({ where: { guildId } });
  await db.deadDropBudget.deleteMany({ where: { guildId } });
  await db.deadDropSettings.deleteMany({ where: { guildId } });
  await db.marketTrade.deleteMany({ where: { guildId } });
  await db.marketQuote.deleteMany({ where: { guildId } });
  await db.collapseCharge.deleteMany({ where: { guildId } });
  await db.ingotMarket.deleteMany({ where: { guildId } });
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

describe("dead drop and funded market collapse", () => {
  it("charges one cell, keeps three picks, rolls one unfound jackpot, and activates one collapse", async () => {
    await grantCapability(db, { guildId, roleId: "staff", capability: "economy_operations", actorUserId: "owner", reason: "Dead Drop test" });
    expect(await fundExceptional(db, { guildId, amountMarks: 80000, idempotencyKey: "drop-pool", reason: "Dead Drop test", actorUserId: "owner", actorRoleIds: staff, now })).toMatchObject({ result: "funded" });
    for (const userId of ["alpha", "beta", "gamma", "delta"]) {
      expect(await issueMarks(db, { guildId, userId, amountMarks: 20000, source: "dead_drop.test", sourceId: userId, pace: "exceptional", idempotencyKey: `drop-fund:${userId}`, reason: "Dead Drop test", actorUserId: "owner", now })).toMatchObject({ result: "posted" });
    }

    const before = await wallet("alpha");
    expect(await readDeadDropStaff(db, guildId)).toMatchObject({ result: "ready", clockLabel: "The opening hour is not selected.", separateDesigns: 0 });
    expect(await quotePick(db, { guildId, userId: "alpha", coordinate: "A1", idempotencyKey: "quote-early", now })).toMatchObject({ result: "schedule_required" });
    expect(await wallet("alpha")).toEqual(before);

    expect(await saveDeadDropSettings(db, { guildId, actorUserId: "owner", actorRoleIds: staff, hour: 10, minute: 0, now })).toMatchObject({ result: "saved", hour: 10, minute: 0, clockLabel: "10:00 Australia/Perth" });
    expect(await db.deadDropBoard.count({ where: { guildId } })).toBe(0);
    expect(await quotePick(db, { guildId, userId: "alpha", coordinate: "A1", idempotencyKey: "quote-unfunded", now })).toMatchObject({ result: "unfunded", budget: "seed" });
    expect(await wallet("alpha")).toEqual(before);

    expect(await fundDeadDropBudget(db, { guildId, pool: "seed", amountMarks: 10, idempotencyKey: "seed-short", reason: "Short starting prize", actorUserId: "owner", actorRoleIds: staff, now })).toMatchObject({ result: "funded" });
    expect(await fundDeadDropBudget(db, { guildId, pool: "seed", amountMarks: 10, idempotencyKey: "seed-short", reason: "Short starting prize", actorUserId: "owner", actorRoleIds: staff, now })).toMatchObject({ result: "already_recorded" });
    expect(await db.deadDropBudget.findUnique({ where: { guildId } })).toMatchObject({ seedAuthorizedMinor: 1_000n });
    expect(await quotePick(db, { guildId, userId: "alpha", coordinate: "A1", idempotencyKey: "quote-short", now })).toMatchObject({ result: "unfunded", budget: "seed" });
    expect(await fundDeadDropBudget(db, { guildId, pool: "seed", amountMarks: 5000, idempotencyKey: "seed-rest", reason: "Fund the starting prize", actorUserId: "owner", actorRoleIds: staff, now })).toMatchObject({ result: "funded" });
    expect(await quotePick(db, { guildId, userId: "alpha", coordinate: "A1", idempotencyKey: "quote-small", now })).toMatchObject({ result: "unfunded", budget: "small" });
    expect(await db.deadDropBoard.count({ where: { guildId } })).toBe(0);
    expect(await wallet("alpha")).toEqual(before);
    expect(await fundDeadDropBudget(db, { guildId, pool: "small", amountMarks: 5000, idempotencyKey: "small-fund", reason: "Fund the small rewards", actorUserId: "owner", actorRoleIds: staff, now })).toMatchObject({ result: "funded" });

    const opened = await db.deadDropBoard.findFirstOrThrow({ where: { guildId, openKey: guildId } });
    expect(opened.opensAt.toISOString()).toBe(now.toISOString());
    expect(opened.closesAt.toISOString()).toBe(closesAt.toISOString());
    expect(opened.seedMinor).toBe(20_000n);
    expect(opened.jackpotMinor).toBe(20_000n);
    expect(opened.status).toBe("open");

    const inspected = await inspectDeadDrop(db, { guildId, actorUserId: "owner", actorRoleIds: staff, reason: "Inspect Dead Drop positions" });
    if (inspected.result !== "ready") {
      throw new Error(inspected.result);
    }
    expect(inspected.cells).toHaveLength(36);
    expect(inspected.cells.filter((cell) => cell.kind === "jackpot")).toHaveLength(1);
    const jackpot = inspected.cells.find((cell) => cell.kind === "jackpot");
    if (!jackpot) {
      throw new Error("missing jackpot");
    }
    const member = await readBoard(db, { guildId, userId: "alpha" });
    const staffView = await readDeadDropStaff(db, guildId);
    if (member.result !== "ready" || staffView.result !== "ready" || !staffView.board) {
      throw new Error("board was not readable");
    }
    expect(member.rules).toContain("does not add another starting seed");
    expect(member.rules).toContain("card-back");
    expect(member.assetNotes.join(" ")).toContain("not required");
    expect(member.separateDesigns).toBe(0);
    expect(JSON.stringify(member.cells)).not.toContain("jackpot");
    expect(JSON.stringify(staffView.board.cells)).not.toContain("jackpot");
    expect(member.cells.find((cell) => cell.coordinate === jackpot.coordinate)).not.toHaveProperty("kind");
    expect(staffView.board.cells.find((cell) => cell.coordinate === jackpot.coordinate)).not.toHaveProperty("kind");
    const audits = await db.auditRecord.findMany({ where: { guildId } });
    expect(audits.some((audit) => audit.action === "dead_drop.inspect")).toBe(true);
    expect(audits.every((audit) => !audit.reason.includes(jackpot.coordinate))).toBe(true);

    expect(await setDeadDropReminder(db, { guildId, userId: "alpha", enabled: true })).toMatchObject({ result: "saved", notice: "setup_required" });
    expect(await sweepDeadDrop(db, now)).toMatchObject({ reminded: 1 });
    const notice = await db.deadDropNotice.findFirstOrThrow({ where: { guildId, userId: "alpha" } });
    expect(notice.status).toBe("setup_required");
    expect(notice.summary).not.toContain(jackpot.coordinate);

    const used = new Set<string>([jackpot.coordinate]);
    const blank = () => {
      const cell = inspected.cells.find((entry) => entry.kind === "blank" && !used.has(entry.coordinate));
      if (!cell) {
        throw new Error("missing blank");
      }
      used.add(cell.coordinate);
      return cell.coordinate;
    };

    const firstCoordinate = blank();
    const firstQuote = await quotePick(db, { guildId, userId: "alpha", coordinate: firstCoordinate, idempotencyKey: "q1", now });
    if (firstQuote.result !== "quoted") {
      throw new Error(firstQuote.result);
    }
    expect(firstQuote.price).toBe("100.00");
    expect(firstQuote.share).toBe("50.00");
    expect(firstQuote.jackpot).toBe("200.00");
    expect(await wallet("alpha")).toEqual(before);
    expect(await pauseDeadDrop(db, { guildId, actorUserId: "owner", actorRoleIds: [], reason: "Pause the board", now })).toMatchObject({ result: "denied" });
    expect(await pauseDeadDrop(db, { guildId, actorUserId: "owner", actorRoleIds: staff, reason: "Pause the board", now })).toMatchObject({ result: "paused" });
    expect(await buyPick(db, { guildId, userId: "alpha", quoteId: firstQuote.quoteId, idempotencyKey: "p1", now })).toMatchObject({ result: "paused" });
    expect(await wallet("alpha")).toEqual(before);
    expect(await resumeDeadDrop(db, { guildId, actorUserId: "owner", actorRoleIds: staff, reason: "Resume the board", now })).toMatchObject({ result: "open" });
    const firstBuy = await buyPick(db, { guildId, userId: "alpha", quoteId: firstQuote.quoteId, idempotencyKey: "p1", now });
    expect(firstBuy.result).toBe("ready");
    if (firstBuy.result === "ready") {
      expect(firstBuy.post).toBe("setup_required");
      expect(firstBuy.receipt).not.toContain(jackpot.coordinate);
    }
    expect(await buyPick(db, { guildId, userId: "alpha", quoteId: firstQuote.quoteId, idempotencyKey: "p1", now })).toMatchObject({ result: "already_recorded" });
    expect(await wallet("alpha")).toEqual({ available: before.available - 10_000n, escrow: 10_000n });

    const secondQuote = await quotePick(db, { guildId, userId: "alpha", coordinate: blank(), idempotencyKey: "q2", now });
    if (secondQuote.result !== "quoted") {
      throw new Error(secondQuote.result);
    }
    const secondBuy = await buyPick(db, { guildId, userId: "alpha", quoteId: secondQuote.quoteId, idempotencyKey: "p2", now });
    expect(secondBuy).toMatchObject({ result: "ready", post: "coalesced" });
    const post = await db.deadDropPost.findFirstOrThrow({ where: { guildId } });
    expect(post.status).toBe("setup_required");
    expect(post.summary).not.toContain(jackpot.coordinate);
    expect(Object.keys(post)).not.toContain("messageId");

    const thirdQuote = await quotePick(db, { guildId, userId: "alpha", coordinate: blank(), idempotencyKey: "q3", now });
    const fourthQuote = await quotePick(db, { guildId, userId: "alpha", coordinate: blank(), idempotencyKey: "q4", now });
    if (thirdQuote.result !== "quoted" || fourthQuote.result !== "quoted") {
      throw new Error("parallel quotes were not opened");
    }
    const beforeParallel = await wallet("alpha");
    const parallel = await Promise.all([
      buyPick(db, { guildId, userId: "alpha", quoteId: thirdQuote.quoteId, idempotencyKey: "p3", now }),
      buyPick(db, { guildId, userId: "alpha", quoteId: fourthQuote.quoteId, idempotencyKey: "p4", now }),
    ]);
    expect(parallel.map((row) => row.result).sort()).toEqual(["limit", "ready"]);
    expect(await wallet("alpha")).toEqual({ available: beforeParallel.available - 10_000n, escrow: beforeParallel.escrow + 10_000n });
    const beforeLimit = await wallet("alpha");
    expect(await quotePick(db, { guildId, userId: "alpha", coordinate: blank(), idempotencyKey: "q5", now })).toMatchObject({ result: "limit" });
    expect(await wallet("alpha")).toEqual(beforeLimit);
    expect(await db.deadDropPick.count({ where: { guildId, userId: "alpha" } })).toBe(3);

    const raceCoordinate = blank();
    const betaQuote = await quotePick(db, { guildId, userId: "beta", coordinate: raceCoordinate, idempotencyKey: "qb", now });
    const gammaQuote = await quotePick(db, { guildId, userId: "gamma", coordinate: raceCoordinate, idempotencyKey: "qg", now });
    if (betaQuote.result !== "quoted" || gammaQuote.result !== "quoted") {
      throw new Error("race quotes were not opened");
    }
    const beforeBeta = await wallet("beta");
    const beforeGamma = await wallet("gamma");
    const raced = await Promise.all([
      buyPick(db, { guildId, userId: "beta", quoteId: betaQuote.quoteId, idempotencyKey: "pb", now }),
      buyPick(db, { guildId, userId: "gamma", quoteId: gammaQuote.quoteId, idempotencyKey: "pg", now }),
    ]);
    expect(raced.map((row) => row.result).sort()).toEqual(["ready", "taken"]);
    const afterBeta = await wallet("beta");
    const afterGamma = await wallet("gamma");
    expect((beforeBeta.available - afterBeta.available) + (beforeGamma.available - afterGamma.available)).toBe(10_000n);
    expect(afterBeta.escrow + afterGamma.escrow).toBe(10_000n);

    const grown = await db.deadDropBoard.findFirstOrThrow({ where: { id: opened.id } });
    expect(grown.jackpotMinor).toBe(20_000n + 5_000n * 4n);
    expect(grown.specialKind).toBe("");

    expect(await saveDeadDropSpecial(db, { guildId, actorUserId: "owner", actorRoleIds: staff, kind: "collapse", payload: "1", reason: "Attach a funded Market Collapse", now })).toMatchObject({ result: "saved", kind: "collapse" });
    const closingCoordinate = blank();
    const closingQuote = await quotePick(db, { guildId, userId: "delta", coordinate: closingCoordinate, idempotencyKey: "q-close", now: closesAt });
    if (closingQuote.result !== "quoted") {
      throw new Error(closingQuote.result);
    }
    const beforeDelta = await wallet("delta");
    const [closingBuy, closing] = await Promise.all([
      buyPick(db, { guildId, userId: "delta", quoteId: closingQuote.quoteId, idempotencyKey: "p-close", now: closesAt }),
      closeDeadDrop(db, { boardId: opened.id, now: closesAt }),
    ]);
    expect(["ready", "closed"]).toContain(closingBuy.result);
    expect(closing).toMatchObject({ result: "rolled", seedAdded: "0.00", opensAt: nextOpen.toISOString() });
    const deltaDrop = beforeDelta.available - (await wallet("delta")).available;
    expect(deltaDrop).toBe(closingBuy.result === "ready" ? 10_000n : 0n);

    const rolled = await db.deadDropBoard.findUniqueOrThrow({ where: { id: opened.id } });
    const carried = await db.deadDropBoard.findFirstOrThrow({ where: { guildId, openKey: guildId } });
    expect(rolled.status).toBe("rolled");
    expect(carried.seedMinor).toBe(0n);
    expect(carried.jackpotMinor).toBe(rolled.jackpotMinor);
    expect(carried.opensAt.toISOString()).toBe(nextOpen.toISOString());
    expect(carried.status).toBe("scheduled");
    expect(carried.commitment).not.toBe(rolled.commitment);
    expect(carried.specialKind).toBe("");
    expect(await db.deadDropBudget.findUnique({ where: { guildId } })).toMatchObject({ seedReservedMinor: 20_000n, seedSpentMinor: 0n });
    expect(await db.collapseCharge.count({ where: { guildId } })).toBe(0);
    expect(await db.deadDropSettings.findUnique({ where: { guildId } })).toMatchObject({ specialKind: "collapse", specialPayload: "1" });
    expect(await closeDeadDrop(db, { boardId: opened.id, now: closesAt })).toMatchObject({ result: "already_recorded" });
    expect(await db.deadDropBudget.findUnique({ where: { guildId } })).toMatchObject({ seedReservedMinor: 20_000n, seedSpentMinor: 0n });

    const history = await readDeadDropHistory(db, guildId);
    if (history.result !== "ready") {
      throw new Error(history.result);
    }
    expect(history.boards.find((board) => board.boardId === opened.id)?.cells.find((cell) => cell.coordinate === jackpot.coordinate)?.kind).toBe("jackpot");
    const carriedView = await readBoard(db, { guildId, userId: "alpha" });
    if (carriedView.result !== "ready") {
      throw new Error(carriedView.result);
    }
    const carriedInspect = await inspectDeadDrop(db, { guildId, actorUserId: "owner", actorRoleIds: staff, reason: "Inspect Dead Drop positions" });
    if (carriedInspect.result !== "ready") {
      throw new Error(carriedInspect.result);
    }
    const carriedJackpot = carriedInspect.cells.find((cell) => cell.kind === "jackpot");
    if (!carriedJackpot) {
      throw new Error("missing carried jackpot");
    }
    expect(carriedView.cells.find((cell) => cell.coordinate === carriedJackpot.coordinate)).not.toHaveProperty("kind");
    const beforeInstant = await wallet("alpha");
    expect(await quotePick(db, { guildId, userId: "alpha", coordinate: "A1", idempotencyKey: "quote-instant", now: closesAt })).toMatchObject({ result: "closed" });
    expect(await wallet("alpha")).toEqual(beforeInstant);

    expect(await allocateEventTreasury(db, { guildId, source: "pool", userId: "delta", quantity: 1, idempotencyKey: "treasury-drop", actorUserId: "owner", actorRoleIds: staff, reason: "Fund a collapse charge", now: nextOpen })).toMatchObject({ result: "allocated" });
    const fundedMarket = await readMarketDiagnostics(db, guildId);
    expect(fundedMarket).toMatchObject({ inventory: "2499", treasury: "1", protected: "2500", total: "5000", conserved: true });
    const curveBefore = await db.ingotMarket.findUniqueOrThrow({ where: { guildId } });

    const beforeWin = await wallet("delta");
    const jackpotBefore = (await db.deadDropBoard.findFirstOrThrow({ where: { guildId, openKey: guildId } })).jackpotMinor;
    const winQuote = await quotePick(db, { guildId, userId: "delta", coordinate: carriedJackpot.coordinate, idempotencyKey: "q-win", now: nextOpen });
    if (winQuote.result !== "quoted") {
      throw new Error(winQuote.result);
    }
    const won = await buyPick(db, { guildId, userId: "delta", quoteId: winQuote.quoteId, idempotencyKey: "p-win", now: nextOpen });
    expect(won).toMatchObject({ result: "ready", boardStatus: "won", nextOpensAt: day3Open.toISOString() });
    expect((await wallet("delta")).available - beforeWin.available).toBe(jackpotBefore + 5_000n - 10_000n);
    expect((await wallet("delta")).escrow).toBe(0n);
    expect((await wallet("alpha")).escrow).toBe(0n);
    const wonBoard = await db.deadDropBoard.findFirstOrThrow({ where: { guildId, winnerUserId: "delta" } });
    const afterWin = await wallet("delta");
    expect(await closeDeadDrop(db, { boardId: wonBoard.id, now: nextOpen })).toMatchObject({ result: "already_recorded" });
    expect(await wallet("delta")).toEqual(afterWin);
    expect(await db.deadDropBudget.findUnique({ where: { guildId } })).toMatchObject({ seedReservedMinor: 20_000n, seedSpentMinor: 20_000n });
    const collapseBoard = await db.deadDropBoard.findFirstOrThrow({ where: { guildId, openKey: guildId } });
    expect(collapseBoard.seedMinor).toBe(20_000n);
    expect(collapseBoard.status).toBe("scheduled");
    expect(collapseBoard.opensAt.toISOString()).toBe(day3Open.toISOString());
    expect(collapseBoard.specialKind).toBe("collapse");
    const charge = await db.collapseCharge.findFirstOrThrow({ where: { guildId } });
    expect(charge).toMatchObject({ status: "funded", holderUserId: "", quantity: 1n });
    expect(await readMarketDiagnostics(db, guildId)).toMatchObject({ inventory: "2499", charges: "1", protected: "2500", conserved: true });

    const collapseInspect = await inspectDeadDrop(db, { guildId, actorUserId: "owner", actorRoleIds: staff, reason: "Inspect Dead Drop positions" });
    if (collapseInspect.result !== "ready") {
      throw new Error(collapseInspect.result);
    }
    const collapseCell = collapseInspect.cells.find((cell) => cell.kind === "collapse");
    if (!collapseCell) {
      throw new Error("missing collapse");
    }
    const hiddenCollapse = await readBoard(db, { guildId, userId: "alpha" });
    if (hiddenCollapse.result !== "ready") {
      throw new Error(hiddenCollapse.result);
    }
    expect(JSON.stringify(hiddenCollapse.cells)).not.toContain(collapseCell.payload);
    const collapseQuote = await quotePick(db, { guildId, userId: "alpha", coordinate: collapseCell.coordinate, idempotencyKey: "q-collapse", now: day3Open });
    if (collapseQuote.result !== "quoted") {
      throw new Error(collapseQuote.result);
    }
    const found = await buyPick(db, { guildId, userId: "alpha", quoteId: collapseQuote.quoteId, idempotencyKey: "p-collapse", now: day3Open });
    expect(found).toMatchObject({ result: "ready", rewardKind: "collapse", chargeId: collapseCell.payload });
    const revealed = await readBoard(db, { guildId, userId: "alpha" });
    if (revealed.result !== "ready") {
      throw new Error(revealed.result);
    }
    expect(JSON.stringify(revealed.cells)).not.toContain(collapseCell.payload);
    expect(revealed.cells.find((cell) => cell.coordinate === collapseCell.coordinate)?.kind).toBe("collapse");

    const activated = await Promise.all([
      activateCollapseCharge(db, { guildId, chargeId: charge.id, actorUserId: "alpha", now: day3Open }),
      activateCollapseCharge(db, { guildId, chargeId: charge.id, actorUserId: "alpha", now: day3Open }),
    ]);
    expect(activated.map((row) => row.result).sort()).toEqual(["activated", "already_activated"]);
    const collapsed = await readMarketDiagnostics(db, guildId);
    expect(collapsed).toMatchObject({ inventory: "2500", charges: "0", protected: "2500", total: "5000", conserved: true, backing: fundedMarket.backing });
    const curveAfter = await db.ingotMarket.findUniqueOrThrow({ where: { guildId } });
    expect(curveAfter.baselineMarks).toBe(curveBefore.baselineMarks);
    expect(curveAfter.curveVersion).toBe(curveBefore.curveVersion);
    expect(curveAfter.spreadBps).toBe(curveBefore.spreadBps);
    expect(await activateCollapseCharge(db, { guildId, chargeId: charge.id, actorUserId: "alpha", now: day3Open })).toMatchObject({ result: "already_activated" });
    expect(await db.ingotMarket.findUnique({ where: { guildId } })).toMatchObject({ inventory: 2500n, protectedReserve: 2500n });
    expect(await releaseProtectedReserve(db, { guildId, actorUserId: "owner", actorRoleIds: staff, reason: "Try to release the reserve" })).toMatchObject({ result: "policy_required" });

    const beforeCancel = await wallet("alpha");
    expect(await cancelDeadDrop(db, { guildId, actorUserId: "owner", actorRoleIds: staff, reason: " ", now: day3Open })).toMatchObject({ result: "invalid" });
    expect(await wallet("alpha")).toEqual(beforeCancel);
    expect(await cancelDeadDrop(db, { guildId, actorUserId: "owner", actorRoleIds: staff, reason: "Cancel the board and refund recorded picks", now: day3Open })).toMatchObject({ result: "cancelled", refunded: 1 });
    const afterCancel = await wallet("alpha");
    expect(afterCancel.available - beforeCancel.available).toBe(10_000n);
    expect(afterCancel.escrow).toBe(0n);
    expect(await cancelDeadDrop(db, { guildId, actorUserId: "owner", actorRoleIds: staff, reason: "Cancel the board and refund recorded picks", now: day3Open })).toMatchObject({ result: "already_recorded" });
    expect(await wallet("alpha")).toEqual(afterCancel);
    expect(await db.deadDropBudget.findUnique({ where: { guildId } })).toMatchObject({ seedReservedMinor: 0n, seedSpentMinor: 20_000n });
    expect(await db.ingotMarket.findUnique({ where: { guildId } })).toMatchObject({ inventory: 2500n, protectedReserve: 2500n, chargeReserve: 0n });
    const reasons = await db.auditRecord.findMany({ where: { guildId } });
    expect(reasons.every((audit) => !audit.reason.includes(jackpot.coordinate) && !audit.reason.includes(collapseCell.payload))).toBe(true);
  }, 60_000);
});
