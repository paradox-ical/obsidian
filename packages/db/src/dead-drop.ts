import { randomInt, randomUUID } from "node:crypto";

import {
  DEAD_DROP_ASSET_NOTES,
  DEAD_DROP_OPEN_MINUTES,
  DEAD_DROP_PICK_CAP,
  DEAD_DROP_PICK_MARKS,
  DEAD_DROP_RULES,
  DEAD_DROP_SEED_MARKS,
  DEAD_DROP_SHARE_BPS,
  DEAD_DROP_SMALL_COUNT,
  DEAD_DROP_SMALL_MARKS,
  assignDeadDropCells,
  boardCommitment,
  deadDropClockDecision,
  deadDropClockLabel,
  deadDropPriceDecision,
  deadDropSeedDecision,
  deadDropShareDecision,
  deadDropSmallDecision,
  deadDropSpecialDecision,
  deadDropSplit,
  deadDropWindowOpen,
  formatMinor,
  marksToMinor,
  nextDeadDropWindow,
  parseCoordinate,
  perthDeadDropWindow,
  presentDeadDropCell,
  renderDeadDropGrid,
} from "@collective/domain";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

import { mintGear } from "./combat.js";
import { moveHeldCurrency } from "./ledger.js";
import { claimCollapseHolder, reserveCollapseCharge } from "./market.js";
import { actorCan, enqueueJob, ensureGuild, moduleIsAvailable, writeAudit, type Writer } from "./platform.js";
import { grantCrate } from "./shop.js";

type Tx = Prisma.TransactionClient;
type Root = PrismaClient;

class Halt extends Error {
  constructor(readonly outcome: "unfunded" | "insufficient" | "limit" | "closed" | "taken" | "schedule_required" | "expired" | "stale" | "missing" | "invalid" | "paused" | "denied", readonly budget?: "seed" | "small") {
    super(outcome);
  }
}

interface BoardRow {
  id: string;
  guildId: string;
  openKey: string;
  chainId: string;
  status: string;
  opensAt: Date;
  closesAt: Date;
  seedMinor: bigint;
  carriedSeedMinor: bigint;
  carriedPoolMinor: bigint;
  carriedTreasuryMinor: bigint;
  shareMinor: bigint;
  treasuryMinor: bigint;
  jackpotMinor: bigint;
  commitment: string;
  specialKind: string;
  previousBoardId: string;
  winnerUserId: string;
  winnerCoordinate: string;
}

interface SettingsRow {
  guildId: string;
  pickMarks: number;
  seedMarks: number;
  smallMarks: number;
  smallCount: number;
  shareBps: number;
  openMinutes: number;
  hour: number | null;
  minute: number | null;
  specialKind: string;
  specialPayload: string;
  version: number;
}

interface BudgetRow {
  seedAuthorizedMinor: bigint;
  seedReservedMinor: bigint;
  seedSpentMinor: bigint;
  smallAuthorizedMinor: bigint;
  smallReservedMinor: bigint;
  smallSpentMinor: bigint;
  treasuryMinor: bigint;
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function money(minor: bigint): string {
  return formatMinor(minor);
}

async function openEconomy(db: Writer, guildId: string) {
  await ensureGuild(db, { guildId });
  return moduleIsAvailable(db, guildId, "economy");
}

async function ensureSettings(tx: Tx, guildId: string): Promise<SettingsRow> {
  await tx.$executeRaw`
    INSERT INTO "dead_drop_settings"
      ("guildId", "pickMarks", "seedMarks", "smallMarks", "smallCount", "shareBps", "openMinutes", "hour", "minute", "specialKind", "specialPayload", "version", "updatedAt")
    VALUES
      (${guildId}, ${DEAD_DROP_PICK_MARKS}, ${DEAD_DROP_SEED_MARKS}, ${DEAD_DROP_SMALL_MARKS}, ${DEAD_DROP_SMALL_COUNT}, ${DEAD_DROP_SHARE_BPS}, ${DEAD_DROP_OPEN_MINUTES}, NULL, NULL, '', '', 1, NOW())
    ON CONFLICT ("guildId") DO NOTHING
  `;
  const settings = await tx.deadDropSettings.findUnique({ where: { guildId } });
  if (!settings) {
    throw new Halt("missing");
  }
  return settings;
}

async function ensureBudget(tx: Tx, guildId: string): Promise<BudgetRow> {
  await tx.$executeRaw`
    INSERT INTO "dead_drop_budget"
      ("guildId", "seedAuthorizedMinor", "seedReservedMinor", "seedSpentMinor", "smallAuthorizedMinor", "smallReservedMinor", "smallSpentMinor", "treasuryMinor", "updatedAt")
    VALUES
      (${guildId}, 0, 0, 0, 0, 0, 0, 0, NOW())
    ON CONFLICT ("guildId") DO NOTHING
  `;
  const rows = await tx.$queryRaw<BudgetRow[]>`
    SELECT "seedAuthorizedMinor", "seedReservedMinor", "seedSpentMinor", "smallAuthorizedMinor", "smallReservedMinor", "smallSpentMinor", "treasuryMinor"
    FROM "dead_drop_budget" WHERE "guildId" = ${guildId} FOR UPDATE
  `;
  const budget = rows[0];
  if (!budget) {
    throw new Halt("missing");
  }
  return {
    seedAuthorizedMinor: BigInt(budget.seedAuthorizedMinor),
    seedReservedMinor: BigInt(budget.seedReservedMinor),
    seedSpentMinor: BigInt(budget.seedSpentMinor),
    smallAuthorizedMinor: BigInt(budget.smallAuthorizedMinor),
    smallReservedMinor: BigInt(budget.smallReservedMinor),
    smallSpentMinor: BigInt(budget.smallSpentMinor),
    treasuryMinor: BigInt(budget.treasuryMinor),
  };
}

function seedRemaining(budget: BudgetRow): bigint {
  return budget.seedAuthorizedMinor - budget.seedReservedMinor - budget.seedSpentMinor;
}

function smallRemaining(budget: BudgetRow): bigint {
  return budget.smallAuthorizedMinor - budget.smallReservedMinor - budget.smallSpentMinor;
}

async function lockBoard(tx: Tx, boardId: string): Promise<BoardRow | null> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "dead_drop_board" WHERE "id" = ${boardId} FOR UPDATE`;
  if (!rows[0]) {
    return null;
  }
  return tx.deadDropBoard.findUnique({ where: { id: rows[0].id } });
}

async function lockLive(tx: Tx, guildId: string): Promise<BoardRow | null> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "dead_drop_board" WHERE "openKey" = ${guildId} FOR UPDATE`;
  if (!rows[0]) {
    return null;
  }
  return tx.deadDropBoard.findUnique({ where: { id: rows[0].id } });
}

async function releaseCoveredSmalls(tx: Tx, boardId: string, guildId: string) {
  const covered = await tx.deadDropCell.findMany({ where: { boardId, kind: "small", status: "covered" } });
  const release = covered.reduce((sum, cell) => sum + (/^[0-9]+$/.test(cell.payload) ? BigInt(cell.payload) : 0n), 0n);
  if (release > 0n) {
    await tx.deadDropBudget.update({ where: { guildId }, data: { smallReservedMinor: { decrement: release } } });
  }
}

async function writeReminders(tx: Tx, board: { id: string; guildId: string }) {
  const people = await tx.deadDropReminder.findMany({ where: { guildId: board.guildId, enabled: true } });
  for (const person of people) {
    try {
      await tx.deadDropNotice.create({
        data: {
          id: randomUUID(),
          guildId: board.guildId,
          boardId: board.id,
          userId: person.userId,
          kind: "reminder",
          status: "setup_required",
          summary: "Dead Drop is open. The notice is not posted.",
        },
      });
    } catch (error) {
      if (!isUnique(error)) {
        throw error;
      }
    }
  }
}

async function touchPost(tx: Tx, board: { id: string; guildId: string }, now: Date): Promise<"setup_required" | "coalesced"> {
  const post = await tx.deadDropPost.findUnique({ where: { boardId: board.id } });
  if (post?.coalesceUntil && post.coalesceUntil > now) {
    return "coalesced";
  }
  const summary = "The board, claimant, and remaining rewards were updated.";
  const coalesceUntil = new Date(now.getTime() + 5_000);
  if (!post) {
    await tx.deadDropPost.create({ data: { boardId: board.id, guildId: board.guildId, revision: 1, status: "setup_required", summary, coalesceUntil } });
  } else {
    await tx.deadDropPost.update({ where: { boardId: board.id }, data: { revision: post.revision + 1, status: "setup_required", summary, coalesceUntil } });
  }
  return "setup_required";
}

async function scheduleBoard(tx: Tx, board: { id: string; guildId: string; opensAt: Date; closesAt: Date }) {
  await enqueueJob(tx, { guildId: board.guildId, jobType: "dead_drop.close", payload: { boardId: board.id }, idempotencyKey: `dead-drop-close:${board.id}:${board.closesAt.toISOString()}`, runAt: board.closesAt });
  await enqueueJob(tx, { guildId: board.guildId, jobType: "dead_drop.remind", payload: { boardId: board.id }, idempotencyKey: `dead-drop-remind:${board.id}:${board.opensAt.toISOString()}`, runAt: board.opensAt });
}

async function createBoard(
  tx: Tx,
  input: {
    guildId: string;
    now: Date;
    mode: "fresh" | "carry" | "after_win";
    previous?: { id: string; opensAt: Date; chainId: string; carriedSeedMinor: bigint; carriedPoolMinor: bigint; carriedTreasuryMinor: bigint };
  },
): Promise<{ board: BoardRow } | { board: null; reason: "schedule_required" | "unfunded"; budget?: "seed" | "small" }> {
  const settings = await ensureSettings(tx, input.guildId);
  if (input.mode === "fresh" && (settings.hour === null || settings.minute === null)) {
    return { board: null, reason: "schedule_required" };
  }
  const budget = await ensureBudget(tx, input.guildId);
  const configuredSeed = marksToMinor(settings.seedMarks) ?? 0n;
  const smallUnit = marksToMinor(settings.smallMarks) ?? 0n;
  const wantedSmall = BigInt(settings.smallCount) * smallUnit;
  let addedSeed = 0n;
  if (input.mode !== "carry") {
    if (seedRemaining(budget) >= configuredSeed) {
      addedSeed = configuredSeed;
    } else if (input.mode === "fresh") {
      return { board: null, reason: "unfunded", budget: "seed" };
    } else {
      await writeAudit(tx, { guildId: input.guildId, actorUserId: "system", action: "dead_drop.seed", targetType: "dead_drop_board", targetId: input.guildId, reason: "The starting seed was not funded" });
    }
  }
  let smallCount = settings.smallCount;
  if (smallRemaining(budget) < wantedSmall) {
    if (input.mode === "fresh") {
      return { board: null, reason: "unfunded", budget: "small" };
    }
    smallCount = 0;
  }
  const window = input.mode === "fresh" && settings.hour !== null && settings.minute !== null
    ? perthDeadDropWindow(input.now, settings.hour, settings.minute)
    : nextDeadDropWindow(input.previous?.opensAt ?? input.now);
  const id = randomUUID();
  const chainId = input.mode === "carry" && input.previous ? input.previous.chainId : id;
  const carriedSeed = input.mode === "carry" && input.previous ? input.previous.carriedSeedMinor : 0n;
  const carriedPool = input.mode === "carry" && input.previous ? input.previous.carriedPoolMinor : 0n;
  const carriedTreasury = input.mode === "carry" && input.previous ? input.previous.carriedTreasuryMinor : 0n;
  let specialKind = "";
  let specialPayload = "";
  if (settings.specialKind === "collapse") {
    const reserved = await reserveCollapseCharge(tx, {
      guildId: input.guildId,
      quantity: Number(settings.specialPayload),
      idempotencyKey: `dead-drop-collapse:${id}`,
      actorUserId: "system",
      reason: "Reserve a Dead Drop Market Collapse",
    });
    if (reserved.result === "unfunded") {
      await writeAudit(tx, { guildId: input.guildId, actorUserId: "system", action: "dead_drop.special", targetType: "dead_drop_board", targetId: id, reason: "Market Collapse was not attached because the event treasury could not fund it" });
    } else {
      specialKind = "collapse";
      specialPayload = reserved.chargeId;
      await tx.deadDropSettings.update({ where: { guildId: input.guildId }, data: { specialKind: "", specialPayload: "" } });
    }
  } else if (settings.specialKind) {
    specialKind = settings.specialKind;
    specialPayload = settings.specialPayload;
    await tx.deadDropSettings.update({ where: { guildId: input.guildId }, data: { specialKind: "", specialPayload: "" } });
  }
  const smallPayload = smallUnit.toString();
  const cells = assignDeadDropCells({ random: (max) => randomInt(0, max), smallCount, smallPayload, specialKind, specialPayload });
  if (addedSeed > 0n) {
    await tx.deadDropBudget.update({ where: { guildId: input.guildId }, data: { seedReservedMinor: { increment: addedSeed } } });
  }
  const reservedSmall = cells.filter((cell) => cell.kind === "small").reduce((sum, cell) => sum + BigInt(cell.payload || "0"), 0n);
  if (reservedSmall > 0n) {
    await tx.deadDropBudget.update({ where: { guildId: input.guildId }, data: { smallReservedMinor: { increment: reservedSmall } } });
  }
  const status = deadDropWindowOpen(input.now, window.opensAt, window.closesAt) ? "open" : "scheduled";
  const board = await tx.deadDropBoard.create({
    data: {
      id,
      guildId: input.guildId,
      openKey: input.guildId,
      chainId,
      status,
      opensAt: window.opensAt,
      closesAt: window.closesAt,
      seedMinor: addedSeed,
      carriedSeedMinor: carriedSeed,
      carriedPoolMinor: carriedPool,
      carriedTreasuryMinor: carriedTreasury,
      shareMinor: 0n,
      treasuryMinor: 0n,
      jackpotMinor: carriedSeed + carriedPool + addedSeed,
      commitment: boardCommitment(cells),
      specialKind,
      previousBoardId: input.previous?.id ?? "",
      winnerUserId: "",
      winnerCoordinate: "",
    },
  });
  await tx.deadDropCell.createMany({
    data: cells.map((cell) => ({
      id: randomUUID(),
      guildId: input.guildId,
      boardId: id,
      coordinate: cell.coordinate,
      kind: cell.kind,
      payload: cell.payload,
      status: "covered",
      userId: "",
    })),
  });
  await scheduleBoard(tx, board);
  if (status === "open") {
    await writeReminders(tx, board);
  }
  return { board };
}

async function ensureFresh(tx: Tx, guildId: string, now: Date) {
  const live = await lockLive(tx, guildId);
  if (live) {
    return { board: live };
  }
  return createBoard(tx, { guildId, now, mode: "fresh" });
}

async function presentBoard(tx: Tx, board: BoardRow, userId: string) {
  const cells = await tx.deadDropCell.findMany({ where: { boardId: board.id }, orderBy: { coordinate: "asc" } });
  const shown = cells.map((cell) => presentDeadDropCell(cell));
  const picksUsed = userId ? await tx.deadDropPick.count({ where: { boardId: board.id, userId } }) : 0;
  return {
    boardId: board.id,
    status: board.status,
    jackpot: money(board.jackpotMinor),
    seedAdded: money(board.seedMinor),
    opensAt: board.opensAt.toISOString(),
    closesAt: board.closesAt.toISOString(),
    commitment: board.commitment,
    specialKind: board.specialKind,
    picksUsed,
    picksLeft: Math.max(0, DEAD_DROP_PICK_CAP - picksUsed),
    cells: shown,
    grid: renderDeadDropGrid(shown),
    separateDesigns: 0,
  };
}

function staffMoney(budget: BudgetRow) {
  return {
    seedRemaining: money(seedRemaining(budget)),
    seedReserved: money(budget.seedReservedMinor),
    seedSpent: money(budget.seedSpentMinor),
    smallRemaining: money(smallRemaining(budget)),
    smallReserved: money(budget.smallReservedMinor),
    smallSpent: money(budget.smallSpentMinor),
    treasury: money(budget.treasuryMinor),
  };
}

async function cellsOf(tx: Tx, boardId: string) {
  return tx.deadDropCell.findMany({ where: { boardId }, orderBy: { coordinate: "asc" } });
}

export async function quotePick(db: Root, input: { guildId: string; userId: string; coordinate: string; idempotencyKey: string; now: Date }) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  const coordinate = parseCoordinate(input.coordinate);
  if (!coordinate || !input.idempotencyKey.trim()) {
    return { result: "invalid" as const, rules: DEAD_DROP_RULES };
  }
  try {
    return await quoteOnce(db, { ...input, coordinate });
  } catch (error) {
    if (error instanceof Halt) {
      return quoteHalt(error);
    }
    if (!isUnique(error)) {
      throw error;
    }
    try {
      return await quoteOnce(db, { ...input, coordinate });
    } catch (retry) {
      if (retry instanceof Halt) {
        return quoteHalt(retry);
      }
      throw retry;
    }
  }
}

function quoteHalt(error: Halt) {
  if (error.outcome === "unfunded") {
    return { result: "unfunded" as const, budget: error.budget ?? "seed", rules: DEAD_DROP_RULES };
  }
  return { result: error.outcome, rules: DEAD_DROP_RULES };
}

async function quoteOnce(db: Root, input: { guildId: string; userId: string; coordinate: string; idempotencyKey: string; now: Date }) {
  return db.$transaction(async (tx) => {
    const existing = await tx.deadDropQuote.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      return presentQuote(existing);
    }
    const prepared = await ensureFresh(tx, input.guildId, input.now);
    if (!prepared.board) {
      throw new Halt(prepared.reason, prepared.budget);
    }
    const board = prepared.board;
    if (board.status === "paused") {
      throw new Halt("paused");
    }
    if (!deadDropWindowOpen(input.now, board.opensAt, board.closesAt)) {
      throw new Halt("closed");
    }
    const cell = await tx.deadDropCell.findUnique({ where: { boardId_coordinate: { boardId: board.id, coordinate: input.coordinate } } });
    if (!cell) {
      throw new Halt("invalid");
    }
    if (cell.status === "revealed") {
      throw new Halt("taken");
    }
    const settings = await ensureSettings(tx, input.guildId);
    const priceMinor = marksToMinor(settings.pickMarks);
    if (priceMinor === null) {
      throw new Halt("invalid");
    }
    const split = deadDropSplit(priceMinor, settings.shareBps);
    const picksUsed = await tx.deadDropPick.count({ where: { boardId: board.id, userId: input.userId } });
    if (picksUsed >= DEAD_DROP_PICK_CAP) {
      throw new Halt("limit");
    }
    const quote = await tx.deadDropQuote.create({
      data: {
        id: randomUUID(),
        guildId: input.guildId,
        userId: input.userId,
        boardId: board.id,
        coordinate: input.coordinate,
        settingsVersion: settings.version,
        priceMinor,
        shareMinor: split.shareMinor,
        jackpotMinor: board.jackpotMinor,
        picksUsed,
        opensAt: board.opensAt,
        closesAt: board.closesAt,
        status: "open",
        idempotencyKey: input.idempotencyKey,
        expiresAt: new Date(input.now.getTime() + 60_000),
      },
    });
    return presentQuote(quote);
  });
}

function presentQuote(quote: { id: string; coordinate: string; priceMinor: bigint; shareMinor: bigint; jackpotMinor: bigint; picksUsed: number; opensAt: Date; closesAt: Date }) {
  return {
    result: "quoted" as const,
    quoteId: quote.id,
    coordinate: quote.coordinate,
    price: money(quote.priceMinor),
    share: money(quote.shareMinor),
    treasury: money(quote.priceMinor - quote.shareMinor),
    jackpot: money(quote.jackpotMinor),
    picksUsed: quote.picksUsed,
    picksLeft: DEAD_DROP_PICK_CAP - quote.picksUsed,
    opensAt: quote.opensAt.toISOString(),
    closesAt: quote.closesAt.toISOString(),
    rules: DEAD_DROP_RULES,
  };
}

async function finishReward(db: Root, pick: { id: string; guildId: string; userId: string; rewardKind: string; rewardDetail: string; rewardRef: string }) {
  if (pick.rewardRef || (pick.rewardKind !== "gear" && pick.rewardKind !== "crate")) {
    return pick.rewardRef;
  }
  if (pick.rewardKind === "gear") {
    const minted = await mintGear(db, { guildId: pick.guildId, userId: pick.userId, templateSlug: pick.rewardDetail, provenance: "dead_drop", idempotencyKey: `dead-drop-gear:${pick.id}` });
    const ref = minted.result === "minted" || minted.result === "already_recorded" ? minted.itemId || "missing" : "missing";
    await db.deadDropPick.update({ where: { id: pick.id }, data: { rewardRef: ref } });
    return ref;
  }
  const granted = await grantCrate(db, { guildId: pick.guildId, userId: pick.userId, tableSlug: pick.rewardDetail, source: "dead_drop", idempotencyKey: `dead-drop-crate:${pick.id}` });
  const ref = granted.result === "ready" || granted.result === "already_recorded" ? granted.grantId : "missing";
  await db.deadDropPick.update({ where: { id: pick.id }, data: { rewardRef: ref } });
  return ref;
}

export async function buyPick(db: Root, input: { guildId: string; userId: string; quoteId: string; idempotencyKey: string; now: Date }) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if (!input.quoteId.trim() || !input.idempotencyKey.trim()) {
    return { result: "invalid" as const };
  }
  const prior = await db.deadDropPick.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (prior) {
    await finishReward(db, prior);
    return { result: "already_recorded" as const, pickId: prior.id };
  }
  try {
    const bought = await db.$transaction(async (tx) => {
      const quotes = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "dead_drop_quote" WHERE "id" = ${input.quoteId} FOR UPDATE`;
      const quote = quotes[0] ? await tx.deadDropQuote.findUnique({ where: { id: quotes[0].id } }) : null;
      if (!quote || quote.guildId !== input.guildId || quote.userId !== input.userId) {
        throw new Halt("missing");
      }
      if (quote.expiresAt <= input.now) {
        throw new Halt("expired");
      }
      const recorded = await tx.deadDropPick.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (recorded) {
        return { result: "already_recorded" as const, pickId: recorded.id, rewardKind: recorded.rewardKind, rewardDetail: recorded.rewardDetail, rewardRef: recorded.rewardRef, receipt: "", post: "setup_required" as const, chargeId: "", jackpot: "", picksUsed: 0, nextOpensAt: null as string | null, boardStatus: "open" };
      }
      if (quote.status !== "open") {
        const pick = await tx.deadDropPick.findFirst({ where: { quoteId: quote.id } });
        if (pick) {
          return { result: "already_recorded" as const, pickId: pick.id, rewardKind: pick.rewardKind, rewardDetail: pick.rewardDetail, rewardRef: pick.rewardRef, receipt: "", post: "setup_required" as const, chargeId: "", jackpot: "", picksUsed: 0, nextOpensAt: null, boardStatus: "open" };
        }
        throw new Halt("closed");
      }
      const board = await lockBoard(tx, quote.boardId);
      if (!board || board.openKey !== input.guildId) {
        throw new Halt("closed");
      }
      if (board.status === "paused") {
        throw new Halt("paused");
      }
      if (board.status !== "open" && board.status !== "scheduled") {
        throw new Halt("closed");
      }
      if (!deadDropWindowOpen(input.now, board.opensAt, board.closesAt)) {
        throw new Halt("closed");
      }
      if (board.status === "scheduled") {
        await tx.deadDropBoard.update({ where: { id: board.id }, data: { status: "open" } });
      }
      const settings = await ensureSettings(tx, input.guildId);
      if (settings.version !== quote.settingsVersion) {
        throw new Halt("stale");
      }
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "dead_drop_cell" WHERE "boardId" = ${board.id} AND "coordinate" = ${quote.coordinate} FOR UPDATE
      `;
      const cell = locked[0] ? await tx.deadDropCell.findUnique({ where: { id: locked[0].id } }) : null;
      if (!cell) {
        throw new Halt("invalid");
      }
      if (cell.status === "revealed") {
        await tx.deadDropQuote.update({ where: { id: quote.id }, data: { status: "closed" } });
        return { result: "taken" as const, pickId: "", rewardKind: "", rewardDetail: "", rewardRef: "", receipt: "", post: "setup_required" as const, chargeId: "", jackpot: money(board.jackpotMinor), picksUsed: 0, nextOpensAt: null, boardStatus: board.status };
      }
      const picksUsed = await tx.deadDropPick.count({ where: { boardId: board.id, userId: input.userId } });
      if (picksUsed >= DEAD_DROP_PICK_CAP) {
        throw new Halt("limit");
      }
      const duplicate = await tx.deadDropPick.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (duplicate) {
        return { result: "already_recorded" as const, pickId: duplicate.id, rewardKind: duplicate.rewardKind, rewardDetail: duplicate.rewardDetail, rewardRef: duplicate.rewardRef, receipt: "", post: "setup_required" as const, chargeId: "", jackpot: "", picksUsed, nextOpensAt: null, boardStatus: "open" };
      }
      const paid = await moveHeldCurrency(tx, {
        guildId: input.guildId,
        userId: input.userId,
        currency: "marks",
        availableDelta: -quote.priceMinor,
        escrowDelta: quote.priceMinor,
        kind: "dead_drop_pick",
        direction: "debit",
        amountMinor: quote.priceMinor,
        source: "dead_drop",
        sourceId: quote.id,
        pace: "market",
        idempotencyKey: input.idempotencyKey,
        reason: "Dead Drop pick",
        actorUserId: input.userId,
        now: input.now,
      });
      if (paid !== "ok") {
        throw new Halt(paid === "insufficient" ? "insufficient" : "invalid");
      }
      const treasuryMinor = quote.priceMinor - quote.shareMinor;
      const pickId = randomUUID();
      await tx.deadDropPick.create({
        data: {
          id: pickId,
          guildId: input.guildId,
          boardId: board.id,
          userId: input.userId,
          coordinate: cell.coordinate,
          quoteId: quote.id,
          priceMinor: quote.priceMinor,
          shareMinor: quote.shareMinor,
          treasuryMinor,
          rewardKind: cell.kind,
          rewardDetail: cell.kind === "blank" || cell.kind === "jackpot" ? "" : cell.payload,
          rewardRef: "",
          status: "open",
          idempotencyKey: input.idempotencyKey,
        },
      });
      await tx.deadDropCell.update({ where: { id: cell.id }, data: { status: "revealed", userId: input.userId, revealedAt: input.now } });
      await tx.deadDropBoard.update({
        where: { id: board.id },
        data: { shareMinor: { increment: quote.shareMinor }, treasuryMinor: { increment: treasuryMinor }, jackpotMinor: { increment: quote.shareMinor } },
      });
      if (cell.kind === "small") {
        const amount = /^[0-9]+$/.test(cell.payload) ? BigInt(cell.payload) : 0n;
        const budget = await ensureBudget(tx, input.guildId);
        if (budget.smallReservedMinor < amount) {
          throw new Halt("unfunded", "small");
        }
        const reward = await moveHeldCurrency(tx, {
          guildId: input.guildId,
          userId: input.userId,
          currency: "marks",
          availableDelta: amount,
          escrowDelta: 0n,
          kind: "dead_drop_small",
          direction: "credit",
          amountMinor: amount,
          source: "dead_drop",
          sourceId: pickId,
          pace: "exceptional",
          idempotencyKey: `dead-drop-small:${pickId}`,
          reason: "Pay a funded Dead Drop small reward",
          actorUserId: "system",
          now: input.now,
        });
        if (reward !== "ok") {
          throw new Halt("invalid");
        }
        await tx.deadDropBudget.update({ where: { guildId: input.guildId }, data: { smallReservedMinor: { decrement: amount }, smallSpentMinor: { increment: amount } } });
      }
      if (cell.kind === "collapse") {
        const claimed = await claimCollapseHolder(tx, { guildId: input.guildId, chargeId: cell.payload, holderUserId: input.userId });
        if (claimed !== "claimed") {
          throw new Halt("invalid");
        }
      }
      let nextOpensAt: string | null = null;
      let boardStatus = "open";
      if (cell.kind === "jackpot") {
        const next = await payJackpot(tx, board.id, input.userId, cell.coordinate, input.now);
        nextOpensAt = next.opensAt.toISOString();
        boardStatus = "won";
      }
      await tx.deadDropQuote.update({ where: { id: quote.id }, data: { status: "used" } });
      const post = await touchPost(tx, board, input.now);
      const current = await tx.deadDropBoard.findUniqueOrThrow({ where: { id: board.id } });
      await writeAudit(tx, { guildId: input.guildId, actorUserId: input.userId, action: "dead_drop.reveal", targetType: "dead_drop_pick", targetId: pickId, reason: "Reveal a paid Dead Drop cell" });
      const jackpot = money(cell.kind === "jackpot" ? current.jackpotMinor : current.jackpotMinor);
      const rewardText = cell.kind === "jackpot"
        ? "Jackpot."
        : cell.kind === "small"
          ? `Small reward ${money(BigInt(cell.payload || "0"))}.`
          : cell.kind === "collapse"
            ? `Market Collapse charge ${cell.payload}.`
            : cell.kind === "clue"
              ? `Clue ${cell.payload}.`
              : cell.kind === "blank"
                ? "Blank."
                : cell.kind;
      const closedText = nextOpensAt ? ` The board is closed. The next board opens ${nextOpensAt}.` : "";
      return {
        result: "ready" as const,
        pickId,
        rewardKind: cell.kind,
        rewardDetail: cell.kind === "blank" || cell.kind === "jackpot" ? "" : cell.payload,
        rewardRef: "",
        receipt: `${cell.coordinate} revealed. ${rewardText} Jackpot ${jackpot}. Picks ${picksUsed + 1} of ${DEAD_DROP_PICK_CAP}.${closedText}`,
        post,
        chargeId: cell.kind === "collapse" ? cell.payload : "",
        jackpot,
        picksUsed: picksUsed + 1,
        nextOpensAt,
        boardStatus,
      };
    });
    if (bought.result === "ready" || bought.result === "already_recorded") {
      const pick = await db.deadDropPick.findUnique({ where: { id: bought.pickId } });
      if (pick) {
        const ref = await finishReward(db, pick);
        if ((pick.rewardKind === "gear" || pick.rewardKind === "crate") && bought.receipt) {
          bought.receipt += ref === "missing" ? " The attached reward was not delivered." : ` Reward ${ref}.`;
        }
      }
    }
    return bought;
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    if (isUnique(error)) {
      const again = await db.deadDropPick.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      return again ? { result: "already_recorded" as const, pickId: again.id } : { result: "closed" as const };
    }
    throw error;
  }
}

async function payJackpot(tx: Tx, boardId: string, winnerUserId: string, coordinate: string, now: Date) {
  const current = await tx.deadDropBoard.findUniqueOrThrow({ where: { id: boardId } });
  const boards = await tx.deadDropBoard.findMany({ where: { chainId: current.chainId } });
  const picks = await tx.deadDropPick.findMany({ where: { boardId: { in: boards.map((board) => board.id) }, status: "open" } });
  const share = picks.reduce((sum, pick) => sum + pick.shareMinor, 0n);
  const treasury = picks.reduce((sum, pick) => sum + pick.treasuryMinor, 0n);
  const seed = current.carriedSeedMinor + current.seedMinor;
  if (share !== current.carriedPoolMinor + current.shareMinor || treasury !== current.carriedTreasuryMinor + current.treasuryMinor) {
    throw new Halt("invalid");
  }
  for (const pick of picks) {
    const released = await moveHeldCurrency(tx, {
      guildId: current.guildId,
      userId: pick.userId,
      currency: "marks",
      availableDelta: 0n,
      escrowDelta: -pick.priceMinor,
      kind: "dead_drop_release",
      direction: "debit",
      amountMinor: pick.priceMinor,
      source: "dead_drop",
      sourceId: pick.id,
      pace: "market",
      idempotencyKey: `dead-drop-release:${pick.id}`,
      reason: "Release a Dead Drop pick into the recorded pool",
      actorUserId: "system",
      now,
    });
    if (released !== "ok") {
      throw new Halt(released === "insufficient" ? "insufficient" : "invalid");
    }
    await tx.deadDropPick.update({ where: { id: pick.id }, data: { status: "settled" } });
  }
  const payout = share + seed;
  if (payout > 0n) {
    const paid = await moveHeldCurrency(tx, {
      guildId: current.guildId,
      userId: winnerUserId,
      currency: "marks",
      availableDelta: payout,
      escrowDelta: 0n,
      kind: "dead_drop_jackpot",
      direction: "credit",
      amountMinor: payout,
      source: "dead_drop",
      sourceId: current.id,
      pace: "exceptional",
      idempotencyKey: `dead-drop-win:${current.id}`,
      reason: "Pay the Dead Drop jackpot",
      actorUserId: "system",
      now,
    });
    if (paid !== "ok") {
      throw new Halt("invalid");
    }
  }
  const budget = await ensureBudget(tx, current.guildId);
  if (budget.seedReservedMinor < seed) {
    throw new Halt("unfunded", "seed");
  }
  await tx.deadDropBudget.update({
    where: { guildId: current.guildId },
    data: { seedReservedMinor: { decrement: seed }, seedSpentMinor: { increment: seed }, treasuryMinor: { increment: treasury } },
  });
  await releaseCoveredSmalls(tx, current.id, current.guildId);
  await tx.deadDropCell.updateMany({ where: { boardId: current.id, status: "covered" }, data: { status: "revealed", revealedAt: now } });
  await tx.deadDropBoard.update({ where: { id: current.id }, data: { status: "won", openKey: current.id, winnerUserId, winnerCoordinate: coordinate, settledAt: now } });
  await writeAudit(tx, { guildId: current.guildId, actorUserId: "system", action: "dead_drop.win", targetType: "dead_drop_board", targetId: current.id, reason: "Pay the Dead Drop jackpot" });
  const created = await createBoard(tx, { guildId: current.guildId, now, mode: "after_win", previous: { id: current.id, opensAt: current.opensAt, chainId: current.chainId, carriedSeedMinor: 0n, carriedPoolMinor: 0n, carriedTreasuryMinor: 0n } });
  if (!created.board) {
    throw new Halt("invalid");
  }
  return created.board;
}

async function rollBoard(tx: Tx, board: BoardRow, now: Date) {
  await releaseCoveredSmalls(tx, board.id, board.guildId);
  await tx.deadDropCell.updateMany({ where: { boardId: board.id, status: "covered" }, data: { status: "revealed", revealedAt: now } });
  await tx.deadDropBoard.update({ where: { id: board.id }, data: { status: "rolled", openKey: board.id, settledAt: now } });
  const created = await createBoard(tx, {
    guildId: board.guildId,
    now,
    mode: "carry",
    previous: {
      id: board.id,
      opensAt: board.opensAt,
      chainId: board.chainId,
      carriedSeedMinor: board.carriedSeedMinor + board.seedMinor,
      carriedPoolMinor: board.carriedPoolMinor + board.shareMinor,
      carriedTreasuryMinor: board.carriedTreasuryMinor + board.treasuryMinor,
    },
  });
  if (!created.board) {
    throw new Halt("invalid");
  }
  await writeAudit(tx, { guildId: board.guildId, actorUserId: "system", action: "dead_drop.roll", targetType: "dead_drop_board", targetId: board.id, reason: "Carry an unfound Dead Drop jackpot" });
  return created.board;
}

export async function closeDeadDrop(db: Root, input: { boardId: string; now: Date }) {
  try {
    return await db.$transaction(async (tx) => {
      const board = await lockBoard(tx, input.boardId);
      if (!board) {
        return { result: "missing" as const };
      }
      if (board.status !== "open" && board.status !== "paused" && board.status !== "scheduled") {
        return { result: "already_recorded" as const, status: board.status, boardId: board.id };
      }
      if (input.now < board.closesAt) {
        if (board.status === "scheduled" && input.now >= board.opensAt) {
          await tx.deadDropBoard.update({ where: { id: board.id }, data: { status: "open" } });
          await writeReminders(tx, board);
        }
        return { result: "open" as const, boardId: board.id };
      }
      const next = await rollBoard(tx, board, input.now);
      return { result: "rolled" as const, boardId: board.id, nextBoardId: next.id, jackpot: money(next.jackpotMinor), seedAdded: money(next.seedMinor), opensAt: next.opensAt.toISOString() };
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    throw error;
  }
}

export async function cancelDeadDrop(db: Root, input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; reason: string; now: Date }) {
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
      const live = await lockLive(tx, input.guildId);
      if (!live) {
        const cancelled = await tx.deadDropBoard.findFirst({ where: { guildId: input.guildId, status: "cancelled" } });
        return cancelled ? { result: "already_recorded" as const } : { result: "missing" as const };
      }
      if (live.status !== "open" && live.status !== "paused" && live.status !== "scheduled") {
        return { result: "already_recorded" as const };
      }
      const boards = await tx.deadDropBoard.findMany({ where: { chainId: live.chainId } });
      const picks = await tx.deadDropPick.findMany({ where: { boardId: { in: boards.map((board) => board.id) }, status: "open" } });
      for (const pick of picks) {
        const refunded = await moveHeldCurrency(tx, {
          guildId: input.guildId,
          userId: pick.userId,
          currency: "marks",
          availableDelta: pick.priceMinor,
          escrowDelta: -pick.priceMinor,
          kind: "dead_drop_refund",
          direction: "credit",
          amountMinor: pick.priceMinor,
          source: "dead_drop",
          sourceId: pick.id,
          pace: "market",
          idempotencyKey: `dead-drop-refund:${pick.id}`,
          reason: "Refund a recorded Dead Drop pick",
          actorUserId: input.actorUserId,
          now: input.now,
        });
        if (refunded !== "ok") {
          throw new Halt(refunded === "insufficient" ? "insufficient" : "invalid");
        }
        await tx.deadDropPick.update({ where: { id: pick.id }, data: { status: "refunded" } });
      }
      const budget = await ensureBudget(tx, input.guildId);
      const seed = live.carriedSeedMinor + live.seedMinor;
      if (budget.seedReservedMinor < seed) {
        throw new Halt("invalid");
      }
      if (seed > 0n) {
        await tx.deadDropBudget.update({ where: { guildId: input.guildId }, data: { seedReservedMinor: { decrement: seed } } });
      }
      await releaseCoveredSmalls(tx, live.id, input.guildId);
      await tx.deadDropCell.updateMany({ where: { boardId: live.id, status: "covered" }, data: { status: "revealed", revealedAt: input.now } });
      await tx.deadDropBoard.update({ where: { id: live.id }, data: { status: "cancelled", openKey: live.id, settledAt: input.now } });
      await writeAudit(tx, { guildId: input.guildId, actorUserId: input.actorUserId, action: "dead_drop.cancel", targetType: "dead_drop_board", targetId: live.id, reason: input.reason });
      return { result: "cancelled" as const, refunded: picks.length };
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    throw error;
  }
}

async function staffGate(db: Root, input: { guildId: string; actorRoleIds: readonly string[] }) {
  if (!(await openEconomy(db, input.guildId))) {
    return "maintenance" as const;
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "economy_operations" })) !== "allowed") {
    return "denied" as const;
  }
  return "allowed" as const;
}

export async function pauseDeadDrop(db: Root, input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; reason: string; now: Date }) {
  const gate = await staffGate(db, input);
  if (gate !== "allowed") {
    return { result: gate };
  }
  if (!input.reason.trim()) {
    return { result: "invalid" as const };
  }
  return db.$transaction(async (tx) => {
    const live = await lockLive(tx, input.guildId);
    if (!live || (live.status !== "open" && live.status !== "scheduled")) {
      return { result: "closed" as const };
    }
    await tx.deadDropBoard.update({ where: { id: live.id }, data: { status: "paused" } });
    await writeAudit(tx, { guildId: input.guildId, actorUserId: input.actorUserId, action: "dead_drop.pause", targetType: "dead_drop_board", targetId: live.id, reason: input.reason });
    return { result: "paused" as const };
  });
}

export async function resumeDeadDrop(db: Root, input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; reason: string; now: Date }) {
  const gate = await staffGate(db, input);
  if (gate !== "allowed") {
    return { result: gate };
  }
  if (!input.reason.trim()) {
    return { result: "invalid" as const };
  }
  return db.$transaction(async (tx) => {
    const live = await lockLive(tx, input.guildId);
    if (!live || live.status !== "paused") {
      return { result: "closed" as const };
    }
    if (input.now > live.closesAt) {
      return { result: "closed" as const };
    }
    await tx.deadDropBoard.update({ where: { id: live.id }, data: { status: input.now >= live.opensAt ? "open" : "scheduled" } });
    await writeAudit(tx, { guildId: input.guildId, actorUserId: input.actorUserId, action: "dead_drop.resume", targetType: "dead_drop_board", targetId: live.id, reason: input.reason });
    return { result: "open" as const };
  });
}

export async function saveDeadDropSettings(db: Root, input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; pickMarks?: number; seedMarks?: number; smallMarks?: number; smallCount?: number; shareBps?: number; hour?: number | null; minute?: number | null; clearClock?: boolean; now: Date }) {
  const gate = await staffGate(db, input);
  if (gate !== "allowed") {
    return { result: gate };
  }
  try {
    return await db.$transaction(async (tx) => {
      const current = await ensureSettings(tx, input.guildId);
      const pickMarks = input.pickMarks ?? current.pickMarks;
      const seedMarks = input.seedMarks ?? current.seedMarks;
      const smallMarks = input.smallMarks ?? current.smallMarks;
      const smallCount = input.smallCount ?? current.smallCount;
      const shareBps = input.shareBps ?? current.shareBps;
      if (deadDropPriceDecision(pickMarks) !== "allowed" || deadDropSeedDecision(seedMarks) !== "allowed" || deadDropSmallDecision(smallMarks, smallCount) !== "allowed" || deadDropShareDecision(shareBps) !== "allowed") {
        throw new Halt("invalid");
      }
      let hour = current.hour;
      let minute = current.minute;
      if (input.clearClock) {
        hour = null;
        minute = null;
      } else if (input.hour !== undefined || input.minute !== undefined) {
        const nextHour = input.hour === undefined ? hour : input.hour;
        const nextMinute = input.minute === undefined ? minute : input.minute;
        if (deadDropClockDecision(nextHour, nextMinute) === "invalid") {
          throw new Halt("invalid");
        }
        hour = nextHour;
        minute = nextMinute;
      }
      const saved = await tx.deadDropSettings.update({ where: { guildId: input.guildId }, data: { pickMarks, seedMarks, smallMarks, smallCount, shareBps, hour, minute, version: current.version + 1 } });
      await ensureFresh(tx, input.guildId, input.now);
      await writeAudit(tx, { guildId: input.guildId, actorUserId: input.actorUserId, action: "dead_drop.settings", targetType: "dead_drop_settings", targetId: input.guildId, reason: input.clearClock ? "Clear the Dead Drop opening hour" : "Save Dead Drop settings" });
      return { result: "saved" as const, version: saved.version, hour: saved.hour, minute: saved.minute, pickMarks: saved.pickMarks, seedMarks: saved.seedMarks, smallMarks: saved.smallMarks, smallCount: saved.smallCount, shareBps: saved.shareBps, clockLabel: deadDropClockLabel(saved.hour, saved.minute) };
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    if (isUnique(error)) {
      const live = await db.deadDropBoard.findFirst({ where: { guildId: input.guildId, openKey: input.guildId } });
      return live ? { result: "saved" as const } : { result: "invalid" as const };
    }
    throw error;
  }
}

export async function fundDeadDropBudget(db: Root, input: { guildId: string; pool: "seed" | "small"; amountMarks: number; idempotencyKey: string; reason: string; actorUserId: string; actorRoleIds: readonly string[]; now: Date }) {
  const gate = await staffGate(db, input);
  if (gate !== "allowed") {
    return { result: gate };
  }
  const amountMinor = marksToMinor(input.amountMarks);
  if ((input.pool !== "seed" && input.pool !== "small") || amountMinor === null || amountMinor <= 0n || !input.idempotencyKey.trim() || !input.reason.trim()) {
    return { result: "invalid" as const };
  }
  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        return { result: "already_recorded" as const };
      }
      await ensureBudget(tx, input.guildId);
      await tx.deadDropBudget.update({
        where: { guildId: input.guildId },
        data: input.pool === "seed" ? { seedAuthorizedMinor: { increment: amountMinor } } : { smallAuthorizedMinor: { increment: amountMinor } },
      });
      await tx.ledgerEntry.create({
        data: {
          id: randomUUID(),
          guildId: input.guildId,
          userId: "system",
          currency: "marks",
          direction: "credit",
          kind: "fund",
          amountMinor,
          source: "dead_drop",
          sourceId: input.idempotencyKey,
          pace: "exceptional",
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
          actorUserId: input.actorUserId,
          createdAt: input.now,
        },
      });
      await ensureFresh(tx, input.guildId, input.now);
      await writeAudit(tx, { guildId: input.guildId, actorUserId: input.actorUserId, action: "dead_drop.fund", targetType: "dead_drop_budget", targetId: input.guildId, reason: input.reason });
      return { result: "funded" as const, pool: input.pool, amount: money(amountMinor) };
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    if (!isUnique(error)) {
      throw error;
    }
    return { result: "already_recorded" as const };
  }
}

export async function saveDeadDropSpecial(db: Root, input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; kind: string; payload: string; reason: string; now: Date }) {
  const gate = await staffGate(db, input);
  if (gate !== "allowed") {
    return { result: gate };
  }
  const kind = input.kind === "clear" || input.kind === "none" ? "" : input.kind;
  const payload = kind === "" ? "" : input.payload.trim();
  if (deadDropSpecialDecision(kind, payload) !== "allowed" || !input.reason.trim()) {
    return { result: "invalid" as const };
  }
  return db.$transaction(async (tx) => {
    await ensureSettings(tx, input.guildId);
    await tx.deadDropSettings.update({ where: { guildId: input.guildId }, data: { specialKind: kind, specialPayload: payload } });
    await writeAudit(tx, { guildId: input.guildId, actorUserId: input.actorUserId, action: "dead_drop.special", targetType: "dead_drop_settings", targetId: input.guildId, reason: input.reason });
    return { result: "saved" as const, kind };
  });
}

export async function inspectDeadDrop(db: Root, input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; reason: string }) {
  const gate = await staffGate(db, input);
  if (gate !== "allowed") {
    return { result: gate };
  }
  if (!input.reason.trim()) {
    return { result: "invalid" as const };
  }
  return db.$transaction(async (tx) => {
    const board = await tx.deadDropBoard.findFirst({ where: { guildId: input.guildId, openKey: input.guildId } });
    if (!board) {
      return { result: "missing" as const };
    }
    const cells = await cellsOf(tx, board.id);
    await writeAudit(tx, { guildId: input.guildId, actorUserId: input.actorUserId, action: "dead_drop.inspect", targetType: "dead_drop_board", targetId: board.id, reason: "Inspect Dead Drop positions" });
    return {
      result: "ready" as const,
      boardId: board.id,
      commitment: board.commitment,
      cells: cells.map((cell) => ({ coordinate: cell.coordinate, kind: cell.kind, payload: cell.payload, status: cell.status, claimant: cell.userId })),
    };
  });
}

export async function setDeadDropReminder(db: Root, input: { guildId: string; userId: string; enabled: boolean }) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  await db.deadDropReminder.upsert({
    where: { guildId_userId: { guildId: input.guildId, userId: input.userId } },
    create: { guildId: input.guildId, userId: input.userId, enabled: input.enabled },
    update: { enabled: input.enabled },
  });
  return { result: "saved" as const, enabled: input.enabled, notice: "setup_required" as const };
}

export async function readBoard(db: Root, input: { guildId: string; userId: string }) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  return db.$transaction(async (tx) => {
    const settings = await ensureSettings(tx, input.guildId);
    const budget = await ensureBudget(tx, input.guildId);
    const board = await tx.deadDropBoard.findFirst({ where: { guildId: input.guildId, openKey: input.guildId } });
    if (!board) {
      if (settings.hour === null || settings.minute === null) {
        return { result: "schedule_required" as const, rules: DEAD_DROP_RULES, clockLabel: deadDropClockLabel(null, null), separateDesigns: 0, assetNotes: [...DEAD_DROP_ASSET_NOTES] };
      }
      const seed = marksToMinor(settings.seedMarks) ?? 0n;
      const small = BigInt(settings.smallCount) * (marksToMinor(settings.smallMarks) ?? 0n);
      if (seedRemaining(budget) < seed) {
        return { result: "unfunded" as const, budget: "seed" as const, rules: DEAD_DROP_RULES, clockLabel: deadDropClockLabel(settings.hour, settings.minute) };
      }
      if (smallRemaining(budget) < small) {
        return { result: "unfunded" as const, budget: "small" as const, rules: DEAD_DROP_RULES, clockLabel: deadDropClockLabel(settings.hour, settings.minute) };
      }
      return { result: "closed" as const, rules: DEAD_DROP_RULES, clockLabel: deadDropClockLabel(settings.hour, settings.minute) };
    }
    const view = await presentBoard(tx, board, input.userId);
    return { result: "ready" as const, rules: DEAD_DROP_RULES, clockLabel: deadDropClockLabel(settings.hour, settings.minute), assetNotes: [...DEAD_DROP_ASSET_NOTES], ...view, ...staffMoney(budget) };
  });
}

export async function readDeadDropHistory(db: Root, guildId: string) {
  if (!(await openEconomy(db, guildId))) {
    return { result: "maintenance" as const };
  }
  const boards = await db.deadDropBoard.findMany({ where: { guildId, status: { in: ["won", "rolled", "cancelled"] } }, orderBy: { settledAt: "desc" }, take: 10 });
  const history = [];
  for (const board of boards) {
    const cells = await db.deadDropCell.findMany({ where: { boardId: board.id }, orderBy: { coordinate: "asc" } });
    history.push({
      boardId: board.id,
      status: board.status,
      jackpot: money(board.jackpotMinor),
      seedAdded: money(board.seedMinor),
      winnerUserId: board.winnerUserId,
      cells: cells.map((cell) => presentDeadDropCell(cell)),
    });
  }
  return { result: "ready" as const, boards: history };
}

export async function readDeadDropStaff(db: Root, guildId: string) {
  if (!(await openEconomy(db, guildId))) {
    return { result: "maintenance" as const };
  }
  return db.$transaction(async (tx) => {
    const settings = await ensureSettings(tx, guildId);
    const budget = await ensureBudget(tx, guildId);
    const board = await tx.deadDropBoard.findFirst({ where: { guildId, openKey: guildId } });
    const view = board ? await presentBoard(tx, board, "") : null;
    const closed = await tx.deadDropBoard.findMany({ where: { guildId, status: { in: ["won", "rolled", "cancelled"] } }, orderBy: { settledAt: "desc" }, take: 5 });
    const history = [];
    for (const row of closed) {
      const cells = await cellsOf(tx, row.id);
      history.push({ boardId: row.id, status: row.status, jackpot: money(row.jackpotMinor), seedAdded: money(row.seedMinor), cells: cells.map((cell) => presentDeadDropCell(cell)) });
    }
    return {
      result: "ready" as const,
      rules: DEAD_DROP_RULES,
      clockLabel: deadDropClockLabel(settings.hour, settings.minute),
      hour: settings.hour,
      minute: settings.minute,
      pickMarks: settings.pickMarks,
      seedMarks: settings.seedMarks,
      smallMarks: settings.smallMarks,
      smallCount: settings.smallCount,
      shareBps: settings.shareBps,
      assetNotes: [...DEAD_DROP_ASSET_NOTES],
      separateDesigns: 0,
      specialPending: settings.specialKind ? { kind: settings.specialKind, payload: settings.specialPayload } : null,
      ...staffMoney(budget),
      board: view,
      history,
    };
  });
}

export async function renderDeadDropPost(db: Root, input: { boardId: string; now: Date }) {
  return db.$transaction(async (tx) => {
    const board = await lockBoard(tx, input.boardId);
    if (!board) {
      return { result: "missing" as const };
    }
    const post = await touchPost(tx, board, input.now);
    return { result: post, summary: "The board, claimant, and remaining rewards were updated." };
  });
}

export async function deliverDeadDropReminder(db: Root, input: { boardId: string; now: Date }) {
  return db.$transaction(async (tx) => {
    const board = await lockBoard(tx, input.boardId);
    if (!board) {
      return { result: "missing" as const };
    }
    if (input.now < board.opensAt) {
      return { result: "waiting" as const };
    }
    if (input.now > board.closesAt || (board.status !== "open" && board.status !== "scheduled" && board.status !== "paused")) {
      return { result: "closed" as const };
    }
    if (board.status === "scheduled") {
      await tx.deadDropBoard.update({ where: { id: board.id }, data: { status: "open" } });
    }
    await writeReminders(tx, board);
    return { result: "setup_required" as const };
  });
}

export async function sweepDeadDrop(db: Root, now: Date) {
  const due = await db.deadDropBoard.findMany({ where: { status: { in: ["open", "paused", "scheduled"] }, closesAt: { lte: now } }, take: 25 });
  for (const board of due) {
    await closeDeadDrop(db, { boardId: board.id, now });
  }
  const opening = await db.deadDropBoard.findMany({ where: { status: { in: ["open", "scheduled"] }, opensAt: { lte: now }, closesAt: { gte: now } }, take: 25 });
  for (const board of opening) {
    await deliverDeadDropReminder(db, { boardId: board.id, now });
  }
  return { closed: due.length, reminded: opening.length };
}
