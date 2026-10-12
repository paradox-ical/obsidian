import { randomInt, randomUUID } from "node:crypto";

import {
  LISTING_FEE_MARKS,
  LISTING_HOURS,
  LISTING_LIMIT,
  MATERIAL_SLUG,
  REROLL_BASE_MARKS,
  TRADE_HOURS,
  UPGRADE_CAP,
  WORKSHOP_RULES,
  affixDecision,
  affixWindow,
  gearTransferDecision,
  marksToMinor,
  priceDecision,
  rerollMarks,
  salvageQuote,
  tradeDue,
  upgradeQuote,
  type AffixRoll,
  type AffixRule,
} from "@collective/domain";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

import { ensureGearCatalog } from "./combat.js";
import { noteContractSignal } from "./contracts.js";
import { moveHeldCurrency } from "./ledger.js";
import { actorCan, enqueueJob, ensureGuild, moduleIsAvailable, writeAudit, type Writer } from "./platform.js";

type Tx = Prisma.TransactionClient;
type Root = PrismaClient;

class Halt extends Error {
  constructor(readonly outcome: "insufficient" | "locked" | "bound" | "equipped" | "missing" | "invalid" | "capped" | "limit" | "destroyed") {
    super(outcome);
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function asAffixes(value: unknown): AffixRoll[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((row) => {
    if (!row || typeof row !== "object" || !("slug" in row) || !("stat" in row) || !("amount" in row)) {
      return [];
    }
    const slug = String(row.slug);
    const stat = String(row.stat);
    const amount = Number(row.amount);
    if (stat !== "accuracy" && stat !== "defence" && stat !== "health" && stat !== "damage") {
      return [];
    }
    return [{ slug, stat, amount }];
  });
}

function asRules(value: unknown): AffixRule[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((row) => {
    if (!row || typeof row !== "object" || !("slug" in row) || !("stat" in row) || !("min" in row) || !("max" in row)) {
      return [];
    }
    const stat = String(row.stat);
    if (stat !== "accuracy" && stat !== "defence" && stat !== "health" && stat !== "damage") {
      return [];
    }
    return [{ slug: String(row.slug), stat, min: Number(row.min), max: Number(row.max) }];
  });
}

function asHistory(value: unknown): Array<{ tier: number; at: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((row) => {
    if (!row || typeof row !== "object" || !("tier" in row)) {
      return [];
    }
    const tier = Number(row.tier);
    const at = "at" in row && typeof row.at === "string" ? row.at : "";
    return Number.isInteger(tier) ? [{ tier, at }] : [];
  });
}

async function openRpg(db: Writer, guildId: string) {
  await ensureGuild(db, { guildId });
  return moduleIsAvailable(db, guildId, "rpg");
}

async function ensureWorkshop(db: Writer, guildId: string) {
  await ensureGearCatalog(db, guildId);
  await db.workshopSettings.upsert({
    where: { guildId },
    create: { guildId, upgradeCap: UPGRADE_CAP, listingLimit: LISTING_LIMIT, listingHours: LISTING_HOURS, listingFeeMarks: LISTING_FEE_MARKS, rerollBaseMarks: REROLL_BASE_MARKS },
    update: {},
  });
  const seeded = await db.craftRecipe.findUnique({ where: { guildId_slug: { guildId, slug: "honed-knife" } } });
  if (!seeded) {
    await db.craftRecipe.create({
      data: {
        id: randomUUID(),
        guildId,
        slug: "honed-knife",
        name: "Honed knife",
        outputSlug: "field-knife",
        outputAffixes: json([{ slug: "honed", stat: "damage", amount: 1 }]),
        inputSlug: MATERIAL_SLUG,
        inputAmount: 2,
        status: "active",
        version: 1,
      },
    });
  }
}

async function settingsOf(db: Writer, guildId: string) {
  await ensureWorkshop(db, guildId);
  const settings = await db.workshopSettings.findUnique({ where: { guildId } });
  if (!settings) {
    throw new Error("Workshop settings were not stored.");
  }
  return settings;
}

async function lockGear(tx: Tx, itemId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "gear_instance" WHERE "id" = ${itemId} FOR UPDATE`;
  return rows[0] ? tx.gearInstance.findUnique({ where: { id: rows[0].id } }) : null;
}

async function inventoryLocked(tx: Tx, guildId: string, userId: string) {
  const character = await tx.playerCharacter.findUnique({ where: { guildId_userId: { guildId, userId } } });
  return Boolean(character?.gameplayLock);
}

function moveGate(item: { binding: string; lock: string; equipped: boolean; destroyed: boolean }, locked: boolean) {
  if (item.destroyed) {
    return "destroyed" as const;
  }
  return gearTransferDecision({ binding: item.binding, locked: item.lock !== "", equipped: item.equipped, inventoryLocked: locked });
}

function workGate(item: { lock: string; equipped: boolean; destroyed: boolean }, locked: boolean) {
  if (item.destroyed) {
    return "destroyed" as const;
  }
  if (locked || item.lock) {
    return "locked" as const;
  }
  if (item.equipped) {
    return "equipped" as const;
  }
  return "allowed" as const;
}

async function spendMarks(tx: Tx, guildId: string, userId: string, marks: number, key: string, reason: string, now: Date) {
  if (marks === 0) {
    return "ok" as const;
  }
  const amountMinor = marksToMinor(marks);
  if (amountMinor === null || amountMinor <= 0n) {
    return "invalid" as const;
  }
  return moveHeldCurrency(tx, {
    guildId,
    userId,
    currency: "marks",
    availableDelta: -amountMinor,
    escrowDelta: 0n,
    kind: "workshop_spend",
    direction: "debit",
    amountMinor,
    source: "workshop",
    sourceId: key,
    pace: "market",
    idempotencyKey: key,
    reason,
    actorUserId: userId,
    now,
  });
}

async function payNet(tx: Tx, guildId: string, fromUserId: string, toUserId: string, offerMarks: number, requestMarks: number, key: string, now: Date) {
  const offer = marksToMinor(offerMarks);
  const request = marksToMinor(requestMarks);
  if (offer === null || request === null) {
    return "invalid" as const;
  }
  const fromDelta = request - offer;
  const toDelta = offer - request;
  for (const userId of [fromUserId, toUserId].sort()) {
    const delta = userId === fromUserId ? fromDelta : toDelta;
    if (delta === 0n) {
      continue;
    }
    const paid = await moveHeldCurrency(tx, {
      guildId,
      userId,
      currency: "marks",
      availableDelta: delta,
      escrowDelta: 0n,
      kind: delta < 0n ? "trade_out" : "trade_in",
      direction: delta < 0n ? "debit" : "credit",
      amountMinor: delta < 0n ? -delta : delta,
      source: "trade",
      sourceId: key,
      pace: "market",
      idempotencyKey: `${key}:${userId}`,
      reason: "Trade or listing settlement",
      actorUserId: "system",
      now,
    });
    if (paid === "insufficient") {
      return "insufficient" as const;
    }
  }
  return "ok" as const;
}

async function changeMaterial(tx: Tx, guildId: string, userId: string, slug: string, delta: number) {
  await tx.$executeRaw`
    INSERT INTO "material_stock" ("id", "guildId", "userId", "slug", "quantity")
    VALUES (${randomUUID()}, ${guildId}, ${userId}, ${slug}, 0)
    ON CONFLICT ("guildId", "userId", "slug") DO NOTHING
  `;
  const rows = await tx.$queryRaw<Array<{ id: string; quantity: number }>>`
    SELECT "id", "quantity" FROM "material_stock"
    WHERE "guildId" = ${guildId} AND "userId" = ${userId} AND "slug" = ${slug}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) {
    return false;
  }
  const next = Number(row.quantity) + delta;
  if (next < 0) {
    return false;
  }
  await tx.materialStock.update({ where: { id: row.id }, data: { quantity: next } });
  return true;
}

async function claimItem(tx: Tx, guildId: string, itemId: string, ownerId: string, locked: boolean) {
  if (!itemId) {
    return null;
  }
  const item = await lockGear(tx, itemId);
  if (!item || item.guildId !== guildId || item.userId !== ownerId) {
    throw new Halt("missing");
  }
  const gate = moveGate(item, locked);
  if (gate !== "allowed") {
    throw new Halt(gate);
  }
  await tx.gearInstance.update({ where: { id: item.id }, data: { lock: "trade" } });
  return item;
}

function presentOffer(offer: { id: string; status: string; version: number; fromUserId: string; toUserId: string; offerItemId: string; requestItemId: string; offerMarks: number; requestMarks: number; fromConfirmedVersion: number; toConfirmedVersion: number; expiresAt: Date }) {
  return {
    result: "ready" as const,
    tradeId: offer.id,
    status: offer.status,
    version: offer.version,
    fromUserId: offer.fromUserId,
    toUserId: offer.toUserId,
    offerItemId: offer.offerItemId,
    requestItemId: offer.requestItemId,
    offerMarks: offer.offerMarks,
    requestMarks: offer.requestMarks,
    fromConfirmed: offer.fromConfirmedVersion === offer.version,
    toConfirmed: offer.toConfirmedVersion === offer.version,
    expiresAt: offer.expiresAt.toISOString(),
    rules: WORKSHOP_RULES,
  };
}

async function releaseTradeItems(tx: Tx, offer: { offerItemId: string; requestItemId: string }) {
  for (const itemId of [offer.offerItemId, offer.requestItemId]) {
    if (!itemId) {
      continue;
    }
    const item = await lockGear(tx, itemId);
    if (item?.lock === "trade") {
      await tx.gearInstance.update({ where: { id: item.id }, data: { lock: "" } });
    }
  }
}

async function settleOffer(tx: Tx, offer: { id: string; guildId: string; fromUserId: string; toUserId: string; offerItemId: string; requestItemId: string; offerMarks: number; requestMarks: number }, now: Date) {
  const pairs = [
    { itemId: offer.offerItemId, ownerId: offer.fromUserId, nextId: offer.toUserId },
    { itemId: offer.requestItemId, ownerId: offer.toUserId, nextId: offer.fromUserId },
  ];
  for (const pair of pairs) {
    if (!pair.itemId) {
      continue;
    }
    const item = await lockGear(tx, pair.itemId);
    if (!item || item.userId !== pair.ownerId || item.lock !== "trade" || item.destroyed) {
      throw new Halt("missing");
    }
  }
  const paid = await payNet(tx, offer.guildId, offer.fromUserId, offer.toUserId, offer.offerMarks, offer.requestMarks, `trade-pay:${offer.id}`, now);
  if (paid !== "ok") {
    throw new Halt(paid === "invalid" ? "invalid" : "insufficient");
  }
  for (const pair of pairs) {
    if (!pair.itemId) {
      continue;
    }
    await tx.gearInstance.update({ where: { id: pair.itemId }, data: { userId: pair.nextId, lock: "", equipped: false } });
  }
  return tx.tradeOffer.update({ where: { id: offer.id }, data: { status: "settled", settledAt: now } });
}

export async function offerTrade(db: Root, input: { guildId: string; userId: string; otherUserId: string; offerItemId?: string; requestItemId?: string; offerMarks: number; requestMarks: number; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if (input.userId === input.otherUserId || priceDecision(input.offerMarks) !== "allowed" || priceDecision(input.requestMarks) !== "allowed") {
    return { result: "invalid" as const };
  }
  const offerItemId = input.offerItemId ?? "";
  const requestItemId = input.requestItemId ?? "";
  if ((!offerItemId && !requestItemId && input.offerMarks === 0 && input.requestMarks === 0) || (offerItemId && offerItemId === requestItemId)) {
    return { result: "invalid" as const };
  }
  await ensureWorkshop(db, input.guildId);
  try {
    return await db.$transaction(async (tx) => {
      const fromLocked = await inventoryLocked(tx, input.guildId, input.userId);
      const toLocked = await inventoryLocked(tx, input.guildId, input.otherUserId);
      await claimItem(tx, input.guildId, offerItemId, input.userId, fromLocked);
      await claimItem(tx, input.guildId, requestItemId, input.otherUserId, toLocked);
      const id = randomUUID();
      const expiresAt = new Date(input.now.getTime() + TRADE_HOURS * 60 * 60 * 1000);
      const offer = await tx.tradeOffer.create({
        data: {
          id,
          guildId: input.guildId,
          fromUserId: input.userId,
          toUserId: input.otherUserId,
          offerItemId,
          requestItemId,
          offerMarks: input.offerMarks,
          requestMarks: input.requestMarks,
          status: "proposed",
          version: 1,
          expiresAt,
          idempotencyKey: `trade:${id}`,
        },
      });
      await enqueueJob(tx, { guildId: input.guildId, jobType: "trade.expire", payload: { tradeId: id }, idempotencyKey: `trade-expire:${id}`, runAt: expiresAt });
      return presentOffer(offer);
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    throw error;
  }
}

export async function inspectTrade(db: Writer, input: { guildId: string; userId: string; tradeId: string }) {
  const offer = await db.tradeOffer.findUnique({ where: { id: input.tradeId } });
  if (!offer || offer.guildId !== input.guildId || (offer.fromUserId !== input.userId && offer.toUserId !== input.userId)) {
    return { result: "missing" as const };
  }
  const items = [];
  for (const itemId of [offer.offerItemId, offer.requestItemId]) {
    if (!itemId) {
      continue;
    }
    const item = await db.gearInstance.findUnique({ where: { id: itemId } });
    const template = item ? await db.gearTemplate.findUnique({ where: { id: item.templateId } }) : null;
    if (!item) {
      continue;
    }
    items.push({
      id: item.id,
      name: item.name,
      binding: item.binding,
      upgradeTier: item.upgradeTier,
      rerollCount: item.rerollCount,
      upgradeHistory: asHistory(item.upgradeHistory),
      affixes: asAffixes(item.affixes),
      ranges: asRules(template?.affixRules),
    });
  }
  return { ...presentOffer(offer), items };
}

export async function confirmTrade(db: Root, input: { guildId: string; userId: string; tradeId: string; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  try {
    return await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "trade_offer" WHERE "id" = ${input.tradeId} FOR UPDATE`;
      const offer = rows[0] ? await tx.tradeOffer.findUnique({ where: { id: rows[0].id } }) : null;
      if (!offer || offer.guildId !== input.guildId || (offer.fromUserId !== input.userId && offer.toUserId !== input.userId)) {
        return { result: "missing" as const };
      }
      if (offer.status !== "proposed") {
        return { result: "closed" as const, tradeId: offer.id, status: offer.status };
      }
      if (tradeDue(offer.expiresAt, input.now)) {
        await releaseTradeItems(tx, offer);
        await tx.tradeOffer.update({ where: { id: offer.id }, data: { status: "expired", settledAt: input.now } });
        return { result: "closed" as const, tradeId: offer.id, status: "expired" };
      }
      const fromConfirmedVersion = offer.fromUserId === input.userId ? offer.version : offer.fromConfirmedVersion;
      const toConfirmedVersion = offer.toUserId === input.userId ? offer.version : offer.toConfirmedVersion;
      const saved = await tx.tradeOffer.update({ where: { id: offer.id }, data: { fromConfirmedVersion, toConfirmedVersion } });
      if (saved.fromConfirmedVersion === saved.version && saved.toConfirmedVersion === saved.version) {
        const settled = await settleOffer(tx, saved, input.now);
        return presentOffer(settled);
      }
      return { ...presentOffer(saved), result: "waiting" as const };
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    throw error;
  }
}

export async function editTrade(db: Root, input: { guildId: string; userId: string; tradeId: string; offerItemId?: string; requestItemId?: string; offerMarks: number; requestMarks: number; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if (priceDecision(input.offerMarks) !== "allowed" || priceDecision(input.requestMarks) !== "allowed") {
    return { result: "invalid" as const };
  }
  const offerItemId = input.offerItemId ?? "";
  const requestItemId = input.requestItemId ?? "";
  if (offerItemId && offerItemId === requestItemId) {
    return { result: "invalid" as const };
  }
  try {
    return await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "trade_offer" WHERE "id" = ${input.tradeId} FOR UPDATE`;
      const offer = rows[0] ? await tx.tradeOffer.findUnique({ where: { id: rows[0].id } }) : null;
      if (!offer || offer.guildId !== input.guildId || (offer.fromUserId !== input.userId && offer.toUserId !== input.userId)) {
        return { result: "missing" as const };
      }
      if (offer.status !== "proposed") {
        return { result: "closed" as const };
      }
      await releaseTradeItems(tx, offer);
      const fromLocked = await inventoryLocked(tx, input.guildId, offer.fromUserId);
      const toLocked = await inventoryLocked(tx, input.guildId, offer.toUserId);
      await claimItem(tx, input.guildId, offerItemId, offer.fromUserId, fromLocked);
      await claimItem(tx, input.guildId, requestItemId, offer.toUserId, toLocked);
      const saved = await tx.tradeOffer.update({
        where: { id: offer.id },
        data: { offerItemId, requestItemId, offerMarks: input.offerMarks, requestMarks: input.requestMarks, version: offer.version + 1 },
      });
      return presentOffer(saved);
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    throw error;
  }
}

export async function cancelTrade(db: Root, input: { guildId: string; userId: string; tradeId: string; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "trade_offer" WHERE "id" = ${input.tradeId} FOR UPDATE`;
    const offer = rows[0] ? await tx.tradeOffer.findUnique({ where: { id: rows[0].id } }) : null;
    if (!offer || offer.guildId !== input.guildId || (offer.fromUserId !== input.userId && offer.toUserId !== input.userId)) {
      return { result: "missing" as const };
    }
    if (offer.status !== "proposed") {
      return { result: "closed" as const };
    }
    await releaseTradeItems(tx, offer);
    await tx.tradeOffer.update({ where: { id: offer.id }, data: { status: "cancelled", settledAt: input.now } });
    return { result: "cancelled" as const, tradeId: offer.id };
  });
}

export async function listItem(db: Root, input: { guildId: string; userId: string; itemId: string; priceMarks: number; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if (priceDecision(input.priceMarks) !== "allowed" || input.priceMarks <= 0) {
    return { result: "invalid" as const };
  }
  const settings = await settingsOf(db, input.guildId);
  try {
    return await db.$transaction(async (tx) => {
      const open = await tx.marketListing.count({ where: { guildId: input.guildId, sellerId: input.userId, status: "open" } });
      if (open >= settings.listingLimit) {
        throw new Halt("limit");
      }
      const locked = await inventoryLocked(tx, input.guildId, input.userId);
      const item = await lockGear(tx, input.itemId);
      if (!item || item.guildId !== input.guildId || item.userId !== input.userId) {
        throw new Halt("missing");
      }
      const gate = moveGate(item, locked);
      if (gate !== "allowed") {
        throw new Halt(gate);
      }
      const fee = await spendMarks(tx, input.guildId, input.userId, settings.listingFeeMarks, `listing-fee:${item.id}:${input.now.toISOString()}`, "Marketplace listing fee", input.now);
      if (fee === "insufficient" || fee === "invalid") {
        throw new Halt(fee === "invalid" ? "invalid" : "insufficient");
      }
      const id = randomUUID();
      const expiresAt = new Date(input.now.getTime() + settings.listingHours * 60 * 60 * 1000);
      await tx.gearInstance.update({ where: { id: item.id }, data: { lock: "listed" } });
      const listing = await tx.marketListing.create({
        data: {
          id,
          guildId: input.guildId,
          sellerId: input.userId,
          itemId: item.id,
          priceMarks: input.priceMarks,
          feeMarks: settings.listingFeeMarks,
          status: "open",
          listingKey: item.id,
          expiresAt,
          idempotencyKey: `listing:${id}`,
        },
      });
      await enqueueJob(tx, { guildId: input.guildId, jobType: "listing.expire", payload: { listingId: id }, idempotencyKey: `listing-expire:${id}`, runAt: expiresAt });
      return { result: "ready" as const, listingId: listing.id, priceMarks: listing.priceMarks, expiresAt: listing.expiresAt.toISOString(), feeMarks: listing.feeMarks };
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    if (isUnique(error)) {
      return { result: "closed" as const };
    }
    throw error;
  }
}

export async function browseListings(db: Writer, input: { guildId: string }) {
  const rows = await db.marketListing.findMany({ where: { guildId: input.guildId, status: "open" }, orderBy: { expiresAt: "asc" }, take: 20 });
  return rows.map((row) => ({ listingId: row.id, sellerId: row.sellerId, itemId: row.itemId, priceMarks: row.priceMarks, expiresAt: row.expiresAt.toISOString() }));
}

export async function inspectListing(db: Writer, input: { guildId: string; listingId: string }) {
  const listing = await db.marketListing.findUnique({ where: { id: input.listingId } });
  if (!listing || listing.guildId !== input.guildId) {
    return { result: "missing" as const };
  }
  const item = await db.gearInstance.findUnique({ where: { id: listing.itemId } });
  const template = item ? await db.gearTemplate.findUnique({ where: { id: item.templateId } }) : null;
  return {
    result: "ready" as const,
    listingId: listing.id,
    status: listing.status,
    priceMarks: listing.priceMarks,
    sellerId: listing.sellerId,
    item: item
      ? { id: item.id, name: item.name, binding: item.binding, upgradeTier: item.upgradeTier, rerollCount: item.rerollCount, upgradeHistory: asHistory(item.upgradeHistory), affixes: asAffixes(item.affixes), ranges: asRules(template?.affixRules) }
      : null,
  };
}

export async function buyListing(db: Root, input: { guildId: string; userId: string; listingId: string; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  try {
    return await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "market_listing" WHERE "id" = ${input.listingId} FOR UPDATE`;
      const listing = rows[0] ? await tx.marketListing.findUnique({ where: { id: rows[0].id } }) : null;
      if (!listing || listing.guildId !== input.guildId) {
        return { result: "missing" as const };
      }
      if (listing.status !== "open" || tradeDue(listing.expiresAt, input.now)) {
        return { result: "closed" as const, listingId: listing.id, status: listing.status };
      }
      if (listing.sellerId === input.userId) {
        return { result: "invalid" as const };
      }
      const item = await lockGear(tx, listing.itemId);
      if (!item || item.userId !== listing.sellerId || item.lock !== "listed") {
        throw new Halt("missing");
      }
      const paid = await payNet(tx, input.guildId, input.userId, listing.sellerId, listing.priceMarks, 0, `listing-pay:${listing.id}`, input.now);
      if (paid !== "ok") {
        throw new Halt(paid === "invalid" ? "invalid" : "insufficient");
      }
      await tx.gearInstance.update({ where: { id: item.id }, data: { userId: input.userId, lock: "", equipped: false } });
      await tx.marketListing.update({ where: { id: listing.id }, data: { status: "sold", buyerId: input.userId, listingKey: listing.id, settledAt: input.now } });
      return { result: "ready" as const, listingId: listing.id, itemId: item.id, priceMarks: listing.priceMarks };
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    throw error;
  }
}

export async function cancelListing(db: Root, input: { guildId: string; userId: string; listingId: string; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "market_listing" WHERE "id" = ${input.listingId} FOR UPDATE`;
    const listing = rows[0] ? await tx.marketListing.findUnique({ where: { id: rows[0].id } }) : null;
    if (!listing || listing.guildId !== input.guildId || listing.sellerId !== input.userId) {
      return { result: "missing" as const };
    }
    if (listing.status !== "open") {
      return { result: "closed" as const };
    }
    const item = await lockGear(tx, listing.itemId);
    if (item?.lock === "listed" && item.userId === listing.sellerId) {
      await tx.gearInstance.update({ where: { id: item.id }, data: { lock: "" } });
    }
    await tx.marketListing.update({ where: { id: listing.id }, data: { status: "cancelled", listingKey: listing.id, settledAt: input.now } });
    return { result: "cancelled" as const, listingId: listing.id };
  });
}

export async function sweepWorkshop(db: Root, now: Date) {
  const trades = await db.tradeOffer.findMany({ where: { status: "proposed", expiresAt: { lte: now } } });
  let expiredTrades = 0;
  for (const row of trades) {
    const expired = await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "trade_offer" WHERE "id" = ${row.id} FOR UPDATE`;
      const offer = locked[0] ? await tx.tradeOffer.findUnique({ where: { id: locked[0].id } }) : null;
      if (!offer || offer.status !== "proposed" || !tradeDue(offer.expiresAt, now)) {
        return false;
      }
      await releaseTradeItems(tx, offer);
      await tx.tradeOffer.update({ where: { id: offer.id }, data: { status: "expired", settledAt: now } });
      return true;
    });
    if (expired) {
      expiredTrades += 1;
    }
  }
  const listings = await db.marketListing.findMany({ where: { status: "open", expiresAt: { lte: now } } });
  let expiredListings = 0;
  for (const row of listings) {
    const expired = await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "market_listing" WHERE "id" = ${row.id} FOR UPDATE`;
      const listing = locked[0] ? await tx.marketListing.findUnique({ where: { id: locked[0].id } }) : null;
      if (!listing || listing.status !== "open" || !tradeDue(listing.expiresAt, now)) {
        return false;
      }
      const item = await lockGear(tx, listing.itemId);
      if (item?.lock === "listed" && item.userId === listing.sellerId) {
        await tx.gearInstance.update({ where: { id: item.id }, data: { lock: "" } });
      }
      await tx.marketListing.update({ where: { id: listing.id }, data: { status: "expired", listingKey: listing.id, settledAt: now } });
      return true;
    });
    if (expired) {
      expiredListings += 1;
    }
  }
  return { expiredTrades, expiredListings };
}

export async function previewUpgrade(db: Writer, input: { guildId: string; userId: string; itemId: string }) {
  const settings = await settingsOf(db, input.guildId);
  const item = await db.gearInstance.findUnique({ where: { id: input.itemId } });
  if (!item || item.guildId !== input.guildId || item.userId !== input.userId) {
    return { result: "missing" as const };
  }
  const quote = upgradeQuote(item.upgradeTier, settings.upgradeCap);
  return quote.result === "capped" ? { result: "capped" as const, tier: item.upgradeTier } : { ...quote, result: "preview" as const, tier: item.upgradeTier };
}

export async function applyUpgrade(db: Root, input: { guildId: string; userId: string; itemId: string; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  const settings = await settingsOf(db, input.guildId);
  try {
    return await db.$transaction(async (tx) => {
      const item = await lockGear(tx, input.itemId);
      if (!item || item.guildId !== input.guildId || item.userId !== input.userId) {
        throw new Halt("missing");
      }
      const gate = workGate(item, await inventoryLocked(tx, input.guildId, input.userId));
      if (gate !== "allowed") {
        throw new Halt(gate);
      }
      const quote = upgradeQuote(item.upgradeTier, settings.upgradeCap);
      if (quote.result === "capped") {
        throw new Halt("capped");
      }
      if (!(await changeMaterial(tx, input.guildId, input.userId, quote.material, -quote.amount))) {
        throw new Halt("insufficient");
      }
      const spent = await spendMarks(tx, input.guildId, input.userId, quote.marks, `upgrade:${item.id}:${quote.nextTier}`, "Guaranteed gear upgrade", input.now);
      if (spent !== "ok" && spent !== "already_recorded") {
        throw new Halt(spent === "invalid" ? "invalid" : "insufficient");
      }
      const saved = await tx.gearInstance.update({
        where: { id: item.id },
        data: { upgradeTier: quote.nextTier, upgradeHistory: json([...asHistory(item.upgradeHistory), { tier: quote.nextTier, at: input.now.toISOString() }]) },
      });
      return { result: "ready" as const, itemId: saved.id, tier: saved.upgradeTier, destroyed: saved.destroyed };
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    throw error;
  }
}

export async function previewSalvage(db: Writer, input: { guildId: string; userId: string; itemId: string }) {
  const item = await db.gearInstance.findUnique({ where: { id: input.itemId } });
  if (!item || item.guildId !== input.guildId || item.userId !== input.userId) {
    return { result: "missing" as const };
  }
  return { result: "preview" as const, ...salvageQuote(item.upgradeTier), destroyed: false };
}

export async function confirmSalvage(db: Root, input: { guildId: string; userId: string; itemId: string; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  try {
    return await db.$transaction(async (tx) => {
      const item = await lockGear(tx, input.itemId);
      if (!item || item.guildId !== input.guildId || item.userId !== input.userId) {
        throw new Halt("missing");
      }
      const gate = workGate(item, await inventoryLocked(tx, input.guildId, input.userId));
      if (gate !== "allowed") {
        throw new Halt(gate);
      }
      const quote = salvageQuote(item.upgradeTier);
      if (!(await changeMaterial(tx, input.guildId, input.userId, quote.material, quote.amount))) {
        throw new Halt("invalid");
      }
      await tx.gearInstance.update({ where: { id: item.id }, data: { destroyed: true, equipped: false, lock: "" } });
      return { result: "destroyed" as const, itemId: item.id, material: quote.material, amount: quote.amount };
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    throw error;
  }
}

export async function previewReroll(db: Writer, input: { guildId: string; userId: string; itemId: string; affix: string }) {
  const settings = await settingsOf(db, input.guildId);
  const item = await db.gearInstance.findUnique({ where: { id: input.itemId } });
  if (!item || item.guildId !== input.guildId || item.userId !== input.userId) {
    return { result: "missing" as const };
  }
  const template = await db.gearTemplate.findUnique({ where: { id: item.templateId } });
  const window = affixWindow(asRules(template?.affixRules).find((rule) => rule.slug === input.affix));
  if (window.result === "missing" || !asAffixes(item.affixes).some((affix) => affix.slug === input.affix)) {
    return { result: "invalid" as const };
  }
  return { ...window, result: "preview" as const, marks: rerollMarks(item.rerollCount, settings.rerollBaseMarks), rerollCount: item.rerollCount };
}

export async function applyReroll(db: Root, input: { guildId: string; userId: string; itemId: string; affix: string; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  const settings = await settingsOf(db, input.guildId);
  try {
    return await db.$transaction(async (tx) => {
      const item = await lockGear(tx, input.itemId);
      if (!item || item.guildId !== input.guildId || item.userId !== input.userId) {
        throw new Halt("missing");
      }
      const gate = workGate(item, await inventoryLocked(tx, input.guildId, input.userId));
      if (gate !== "allowed") {
        throw new Halt(gate);
      }
      const template = await tx.gearTemplate.findUnique({ where: { id: item.templateId } });
      const rule = asRules(template?.affixRules).find((row) => row.slug === input.affix);
      const window = affixWindow(rule);
      const current = asAffixes(item.affixes);
      if (window.result === "missing" || !current.some((affix) => affix.slug === input.affix)) {
        throw new Halt("invalid");
      }
      const marks = rerollMarks(item.rerollCount, settings.rerollBaseMarks);
      const spent = await spendMarks(tx, input.guildId, input.userId, marks, `reroll:${item.id}:${item.rerollCount + 1}`, "Single affix reroll", input.now);
      if (spent !== "ok" && spent !== "already_recorded") {
        throw new Halt(spent === "invalid" ? "invalid" : "insufficient");
      }
      const amount = randomInt(window.min, window.max + 1);
      const affixes = current.map((affix) => affix.slug === input.affix ? { ...affix, amount } : affix);
      const saved = await tx.gearInstance.update({ where: { id: item.id }, data: { affixes: json(affixes), rerollCount: item.rerollCount + 1 } });
      return { result: "ready" as const, itemId: saved.id, affix: input.affix, amount, min: window.min, max: window.max, rerollCount: saved.rerollCount, marks };
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    throw error;
  }
}

export async function listRecipes(db: Writer, guildId: string) {
  await ensureWorkshop(db, guildId);
  const recipes = await db.craftRecipe.findMany({ where: { guildId, status: "active" }, orderBy: { slug: "asc" } });
  return recipes.map((recipe) => ({ slug: recipe.slug, name: recipe.name, outputSlug: recipe.outputSlug, affixes: asAffixes(recipe.outputAffixes), inputSlug: recipe.inputSlug, inputAmount: recipe.inputAmount, version: recipe.version }));
}

export async function previewCraft(db: Writer, input: { guildId: string; recipeSlug: string }) {
  await ensureWorkshop(db, input.guildId);
  const recipe = await db.craftRecipe.findUnique({ where: { guildId_slug: { guildId: input.guildId, slug: input.recipeSlug } } });
  if (!recipe || recipe.status !== "active") {
    return { result: "missing" as const };
  }
  return { result: "preview" as const, slug: recipe.slug, name: recipe.name, outputSlug: recipe.outputSlug, affixes: asAffixes(recipe.outputAffixes), inputSlug: recipe.inputSlug, inputAmount: recipe.inputAmount };
}

export async function craftItem(db: Root, input: { guildId: string; userId: string; recipeSlug: string; idempotencyKey: string; now: Date }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  await ensureWorkshop(db, input.guildId);
  const existing = await db.gearInstance.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    return { result: "already_recorded" as const, itemId: existing.id };
  }
  const recipe = await db.craftRecipe.findUnique({ where: { guildId_slug: { guildId: input.guildId, slug: input.recipeSlug } } });
  if (!recipe || recipe.status !== "active") {
    return { result: "missing" as const };
  }
  try {
    const crafted = await db.$transaction(async (tx) => {
      const again = await tx.gearInstance.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (again) {
        return { result: "already_recorded" as const, itemId: again.id };
      }
      const template = await tx.gearTemplate.findUnique({ where: { guildId_slug: { guildId: input.guildId, slug: recipe.outputSlug } } });
      if (!template || template.status !== "active") {
        throw new Halt("missing");
      }
      const affixes = asAffixes(recipe.outputAffixes);
      if (affixDecision(asRules(template.affixRules), affixes, template.affixMax) !== "allowed") {
        throw new Halt("invalid");
      }
      if (!(await changeMaterial(tx, input.guildId, input.userId, recipe.inputSlug, -recipe.inputAmount))) {
        throw new Halt("insufficient");
      }
      const item = await tx.gearInstance.create({
        data: {
          id: randomUUID(),
          guildId: input.guildId,
          userId: input.userId,
          templateId: template.id,
          name: template.name,
          slot: template.slot,
          classSlug: template.classSlug,
          level: template.level,
          binding: template.binding,
          diceCount: template.diceCount,
          diceSides: template.diceSides,
          critMultiplier: template.critMultiplier,
          abilitySlug: template.abilitySlug,
          affixes: json(affixes),
          provenance: `craft:${recipe.slug}:v${recipe.version}`,
          equipped: false,
          lock: "",
          destroyed: false,
          upgradeTier: 0,
          rerollCount: 0,
          upgradeHistory: json([]),
          templateVersion: template.version,
          idempotencyKey: input.idempotencyKey,
        },
      });
      return { result: "ready" as const, itemId: item.id, affixes };
    });
    if (crafted.result === "ready") {
      await noteContractSignal(db, { guildId: input.guildId, userId: input.userId, kind: "rpg_crafting", amount: 1, now: input.now });
    }
    return crafted;
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    if (isUnique(error)) {
      const again = await db.gearInstance.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      return { result: "already_recorded" as const, itemId: again?.id ?? "" };
    }
    throw error;
  }
}

export async function readMaterials(db: Writer, input: { guildId: string; userId: string }) {
  await ensureWorkshop(db, input.guildId);
  const rows = await db.materialStock.findMany({ where: { guildId: input.guildId, userId: input.userId }, orderBy: { slug: "asc" } });
  return rows.map((row) => ({ slug: row.slug, quantity: row.quantity }));
}

export async function readWorkshopStaff(db: Writer, guildId: string) {
  const settings = await settingsOf(db, guildId);
  const templates = await db.gearTemplate.findMany({ where: { guildId }, orderBy: { slug: "asc" } });
  return {
    rules: WORKSHOP_RULES,
    caps: { upgradeCap: settings.upgradeCap, listingLimit: settings.listingLimit, listingHours: settings.listingHours, listingFeeMarks: settings.listingFeeMarks, rerollBaseMarks: settings.rerollBaseMarks },
    recipes: await listRecipes(db, guildId),
    ranges: templates.map((template) => ({ slug: template.slug, name: template.name, affixRules: asRules(template.affixRules) })),
  };
}

export async function saveWorkshopCaps(db: Root, input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; upgradeCap: number; listingLimit: number; listingHours: number; listingFeeMarks: number; rerollBaseMarks: number }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "content_management" })) !== "allowed") {
    return { result: "denied" as const };
  }
  if (![input.upgradeCap, input.listingLimit, input.listingHours, input.listingFeeMarks, input.rerollBaseMarks].every((value) => Number.isInteger(value))) {
    return { result: "invalid" as const };
  }
  if (input.upgradeCap < 1 || input.upgradeCap > UPGRADE_CAP || input.listingLimit < 1 || input.listingLimit > 10 || input.listingHours < 1 || input.listingHours > 168 || input.listingFeeMarks < 0 || input.listingFeeMarks > 1000 || input.rerollBaseMarks < 1 || input.rerollBaseMarks > 1000) {
    return { result: "invalid" as const };
  }
  await ensureWorkshop(db, input.guildId);
  await db.workshopSettings.update({
    where: { guildId: input.guildId },
    data: { upgradeCap: input.upgradeCap, listingLimit: input.listingLimit, listingHours: input.listingHours, listingFeeMarks: input.listingFeeMarks, rerollBaseMarks: input.rerollBaseMarks },
  });
  await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "workshop.caps", targetType: "workshop_settings", targetId: input.guildId, reason: "Edit workshop caps" });
  return { result: "saved" as const };
}

export async function saveRecipe(db: Root, input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; slug: string; name: string; outputSlug: string; inputAmount: number; affixSlug: string; affixStat: string; affixAmount: number }) {
  if (!(await openRpg(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "content_management" })) !== "allowed") {
    return { result: "denied" as const };
  }
  await ensureWorkshop(db, input.guildId);
  if (!input.slug.trim() || !input.name.trim() || !Number.isInteger(input.inputAmount) || input.inputAmount < 1) {
    return { result: "invalid" as const };
  }
  const template = await db.gearTemplate.findUnique({ where: { guildId_slug: { guildId: input.guildId, slug: input.outputSlug } } });
  if (!template) {
    return { result: "missing" as const };
  }
  const stat = input.affixStat;
  if (stat !== "accuracy" && stat !== "defence" && stat !== "health" && stat !== "damage") {
    return { result: "invalid" as const };
  }
  const affix: AffixRoll = { slug: input.affixSlug, stat, amount: input.affixAmount };
  if (affixDecision(asRules(template.affixRules), [affix], template.affixMax) !== "allowed") {
    return { result: "invalid" as const };
  }
  const current = await db.craftRecipe.findUnique({ where: { guildId_slug: { guildId: input.guildId, slug: input.slug.trim() } } });
  if (current) {
    await db.craftRecipe.update({
      where: { id: current.id },
      data: { name: input.name.trim(), outputSlug: input.outputSlug, outputAffixes: json([affix]), inputSlug: MATERIAL_SLUG, inputAmount: input.inputAmount, version: current.version + 1, status: "active" },
    });
    await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "workshop.recipe", targetType: "craft_recipe", targetId: current.id, reason: "Edit crafting recipe" });
    return { result: "saved" as const, version: current.version + 1 };
  }
  const created = await db.craftRecipe.create({
    data: { id: randomUUID(), guildId: input.guildId, slug: input.slug.trim(), name: input.name.trim(), outputSlug: input.outputSlug, outputAffixes: json([affix]), inputSlug: MATERIAL_SLUG, inputAmount: input.inputAmount, status: "active", version: 1 },
  });
  await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "workshop.recipe", targetType: "craft_recipe", targetId: created.id, reason: "Add crafting recipe" });
  return { result: "saved" as const, version: 1 };
}
