import { randomUUID } from "node:crypto";

import { PRIVATE_INBOX_DETAIL } from "@collective/domain";
import { afterAll, describe, expect, it } from "vitest";

import { claimGiveaway, closeGiveaway, createGiveaway, drawGiveaway, enterGiveaway, savePrizeStock } from "./activities.js";
import { chooseClass } from "./characters.js";
import { createPrismaClient } from "./client.js";
import { fundExceptional, issueMarks } from "./ledger.js";
import { confirmQuote, quoteMarket, readMarketDiagnostics } from "./market.js";
import { grantCapability } from "./platform.js";
import {
  browseShop,
  buyOffer,
  deliverPurchase,
  grantCrate,
  importSteamKey,
  openCrate,
  previewCrate,
  readShopStaff,
  refundPurchase,
  reviewRefund,
  revealPurchase,
  saveCrateTable,
  saveShopOffer,
} from "./shop.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const previousSecret = process.env["SHOP_KEY_SECRET"];
process.env["SHOP_KEY_SECRET"] = "shop-test-secret-value";

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const now = new Date("2026-10-12T02:00:00.000Z");
const later = new Date("2026-10-12T03:00:00.000Z");
const staff = ["staff"];
const secret = "STEAM-SECRET-001";

async function marks(userId: string) {
  const wallet = await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId, userId, currency: "marks" } } });
  return Number(wallet?.availableMinor ?? 0n) / 100;
}

async function ingots(userId: string) {
  const wallet = await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId, userId, currency: "ingots" } } });
  return { available: Number(wallet?.availableMinor ?? 0n), escrow: Number(wallet?.escrowMinor ?? 0n) };
}

afterAll(async () => {
  if (previousSecret === undefined) {
    delete process.env["SHOP_KEY_SECRET"];
  } else {
    process.env["SHOP_KEY_SECRET"] = previousSecret;
  }
  await db.deliveryInbox.deleteMany({ where: { guildId } });
  await db.steamKey.deleteMany({ where: { guildId } });
  await db.shopPurchase.deleteMany({ where: { guildId } });
  await db.shopOffer.deleteMany({ where: { guildId } });
  await db.crateGrant.deleteMany({ where: { guildId } });
  await db.cratePity.deleteMany({ where: { guildId } });
  await db.crateEntry.deleteMany({ where: { guildId } });
  await db.crateTable.deleteMany({ where: { guildId } });
  await db.cosmeticItem.deleteMany({ where: { guildId } });
  await db.materialStock.deleteMany({ where: { guildId } });
  await db.prizeFulfilment.deleteMany({ where: { guildId } });
  await db.giveawayDraw.deleteMany({ where: { guildId } });
  await db.giveawayEntry.deleteMany({ where: { guildId } });
  await db.giveaway.deleteMany({ where: { guildId } });
  await db.prizeStock.deleteMany({ where: { guildId } });
  await db.gearInstance.deleteMany({ where: { guildId } });
  await db.gearTemplate.deleteMany({ where: { guildId } });
  await db.testOpponent.deleteMany({ where: { guildId } });
  await db.marketTrade.deleteMany({ where: { guildId } });
  await db.marketQuote.deleteMany({ where: { guildId } });
  await db.ingotMarket.deleteMany({ where: { guildId } });
  await db.job.deleteMany({ where: { guildId } });
  await db.characterXpEvent.deleteMany({ where: { guildId } });
  await db.playerCharacter.deleteMany({ where: { guildId } });
  await db.classAbility.deleteMany({ where: { guildId } });
  await db.classDefinition.deleteMany({ where: { guildId } });
  await db.characterCurve.deleteMany({ where: { guildId } });
  await db.ledgerEntry.deleteMany({ where: { guildId } });
  await db.wallet.deleteMany({ where: { guildId } });
  await db.issuanceBudget.deleteMany({ where: { guildId } });
  await db.economySettings.deleteMany({ where: { guildId } });
  await db.auditRecord.deleteMany({ where: { guildId } });
  await db.capabilityGrant.deleteMany({ where: { guildId } });
  await db.featureFlag.deleteMany({ where: { guildId } });
  await db.outboxMessage.deleteMany({ where: { guildId } });
  await db.guild.deleteMany({ where: { guildId } });
  await db.$disconnect();
});

describe("shops, private keys, and crates", () => {
  it("conserves stock and Ingots, hides keys, and keeps a stored crate result", async () => {
    await grantCapability(db, { guildId, roleId: "staff", capability: "economy_operations", actorUserId: "owner", reason: "test" });
    await grantCapability(db, { guildId, roleId: "staff", capability: "event_management", actorUserId: "owner", reason: "test" });
    expect(await fundExceptional(db, { guildId, amountMarks: 40000, idempotencyKey: "shop-pool", reason: "Shop test", actorUserId: "owner", actorRoleIds: staff, now })).toMatchObject({ result: "funded" });
    expect(await chooseClass(db, { guildId, userId: "alpha", classSlug: "hitman", now })).toMatchObject({ result: "chosen" });
    expect(await issueMarks(db, { guildId, userId: "alpha", amountMarks: 20000, source: "shop.test", sourceId: "alpha", pace: "exceptional", idempotencyKey: "fund:alpha", reason: "Shop test", actorUserId: "owner", now })).toMatchObject({ result: "posted" });
    expect(await issueMarks(db, { guildId, userId: "beta", amountMarks: 500, source: "shop.test", sourceId: "beta", pace: "exceptional", idempotencyKey: "fund:beta", reason: "Shop test", actorUserId: "owner", now })).toMatchObject({ result: "posted" });

    const quoted = await quoteMarket(db, { guildId, userId: "alpha", side: "buy", quantity: 1, idempotencyKey: "shop-ingot", now });
    if (quoted.result !== "quoted") {
      throw new Error(quoted.result);
    }
    expect(await confirmQuote(db, { guildId, userId: "alpha", quoteId: quoted.quoteId, now })).toMatchObject({ result: "committed" });
    expect((await readMarketDiagnostics(db, guildId)).inventory).toBe("2499");
    const backing = (await readMarketDiagnostics(db, guildId)).backing;

    delete process.env["SHOP_KEY_SECRET"];
    expect(await importSteamKey(db, { guildId, actorUserId: "owner", actorRoleIds: staff, offerSlug: "steam-key", keyMaterial: secret, now })).toMatchObject({ result: "setup_required" });
    process.env["SHOP_KEY_SECRET"] = "shop-test-secret-value";
    expect(await db.steamKey.count({ where: { guildId } })).toBe(0);

    const supply = await browseShop(db, { guildId, shop: "supply", userId: "alpha", now });
    expect(supply.result).toBe("ready");
    if (supply.result === "ready") {
      expect(supply.offers.some((offer) => offer.slug === "later-ration")).toBe(false);
      expect(supply.offers.find((offer) => offer.slug === "field-crate")?.crate?.policy).toBe("roll_at_acquisition");
    }
    expect(await saveShopOffer(db, { guildId, actorUserId: "owner", actorRoleIds: staff, slug: "closed-ration", name: "Closed ration", shop: "supply", currency: "marks", price: 5, stock: 2, limitPerMember: 0, minLevel: 1, requiredRoleId: "", classSlug: "", deliverable: "service", deliverableSlug: "ration", amount: 1, duplicatePolicy: "keep", endsAt: new Date("2026-10-11T00:00:00.000Z") })).toMatchObject({ result: "saved" });
    expect(await buyOffer(db, { guildId, userId: "alpha", offerSlug: "closed-ration", idempotencyKey: "closed", now })).toMatchObject({ result: "closed" });
    expect(await saveShopOffer(db, { guildId, actorUserId: "owner", actorRoleIds: staff, slug: "veteran-blade", name: "Veteran blade", shop: "supply", currency: "marks", price: 5, stock: 1, limitPerMember: 0, minLevel: 10, requiredRoleId: "", classSlug: "", deliverable: "service", deliverableSlug: "blade", amount: 1, duplicatePolicy: "keep" })).toMatchObject({ result: "saved" });
    const beforeGate = await marks("alpha");
    expect(await buyOffer(db, { guildId, userId: "alpha", offerSlug: "veteran-blade", idempotencyKey: "level", now })).toMatchObject({ result: "level" });
    expect(await saveShopOffer(db, { guildId, actorUserId: "owner", actorRoleIds: staff, slug: "vip-pass", name: "VIP pass", shop: "supply", currency: "marks", price: 5, stock: 1, limitPerMember: 1, minLevel: 1, requiredRoleId: "vip", classSlug: "", deliverable: "service", deliverableSlug: "pass", amount: 1, duplicatePolicy: "keep" })).toMatchObject({ result: "saved" });
    expect(await buyOffer(db, { guildId, userId: "alpha", offerSlug: "vip-pass", idempotencyKey: "role", roleIds: [], now })).toMatchObject({ result: "denied" });
    expect(await marks("alpha")).toBe(beforeGate);

    expect(await saveShopOffer(db, { guildId, actorUserId: "owner", actorRoleIds: staff, slug: "last-bandage", name: "Last bandage", shop: "supply", currency: "marks", price: 30, stock: 1, limitPerMember: 0, minLevel: 1, requiredRoleId: "", classSlug: "", deliverable: "material", deliverableSlug: "scrap", amount: 1, duplicatePolicy: "keep" })).toMatchObject({ result: "saved" });
    const beforeRace = (await marks("alpha")) + (await marks("beta"));
    const raced = await Promise.all([
      buyOffer(db, { guildId, userId: "alpha", offerSlug: "last-bandage", idempotencyKey: "race-a", now }),
      buyOffer(db, { guildId, userId: "beta", offerSlug: "last-bandage", idempotencyKey: "race-b", now }),
    ]);
    expect(raced.filter((row) => row.result === "ready")).toHaveLength(1);
    expect(raced.filter((row) => row.result === "insufficient")).toHaveLength(1);
    expect(await db.shopOffer.findUnique({ where: { guildId_slug: { guildId, slug: "last-bandage" } } })).toMatchObject({ stock: 0 });
    expect((await marks("alpha")) + (await marks("beta"))).toBe(beforeRace - 30);
    const retries = await Promise.all([
      buyOffer(db, { guildId, userId: "alpha", offerSlug: "last-bandage", idempotencyKey: "race-a", now }),
      buyOffer(db, { guildId, userId: "beta", offerSlug: "last-bandage", idempotencyKey: "race-b", now }),
    ]);
    expect(retries.filter((row) => row.result === "already_recorded")).toHaveLength(1);
    expect(retries.filter((row) => row.result === "insufficient")).toHaveLength(1);
    expect(await db.shopOffer.findUnique({ where: { guildId_slug: { guildId, slug: "last-bandage" } } })).toMatchObject({ stock: 0 });

    const knifeBefore = await marks("alpha");
    const firstKnife = await buyOffer(db, { guildId, userId: "alpha", offerSlug: "field-knife", idempotencyKey: "knife-once", now });
    const secondKnife = await buyOffer(db, { guildId, userId: "alpha", offerSlug: "field-knife", idempotencyKey: "knife-once", now });
    expect(firstKnife.result === "ready" || firstKnife.result === "already_recorded").toBe(true);
    expect(secondKnife).toMatchObject({ result: "already_recorded" });
    expect(await db.gearInstance.count({ where: { guildId, idempotencyKey: { startsWith: "shop:" } } })).toBe(1);
    expect(await marks("alpha")).toBe(knifeBefore - 50);

    expect(await saveShopOffer(db, { guildId, actorUserId: "owner", actorRoleIds: staff, slug: "test-key", name: "Test key", shop: "ingot", currency: "ingots", price: 1, stock: 0, limitPerMember: 0, minLevel: 1, requiredRoleId: "", classSlug: "", deliverable: "steam_key", deliverableSlug: "test-key", amount: 1, duplicatePolicy: "keep" })).toMatchObject({ result: "saved" });
    const imported = await importSteamKey(db, { guildId, actorUserId: "owner", actorRoleIds: staff, offerSlug: "test-key", keyMaterial: secret, now });
    expect(imported).toMatchObject({ result: "stocked" });
    const held = await buyOffer(db, { guildId, userId: "alpha", offerSlug: "test-key", idempotencyKey: "key-hold", now });
    expect(held).toMatchObject({ result: "ready", status: "held", deliverable: "steam_key" });
    expect(await ingots("alpha")).toEqual({ available: 0, escrow: 1 });
    expect((await readMarketDiagnostics(db, guildId)).inventory).toBe("2499");
    if (held.result !== "ready") {
      throw new Error(held.result);
    }
    expect(await refundPurchase(db, { guildId, userId: "alpha", purchaseId: held.purchaseId, now })).toMatchObject({ result: "refunded" });
    expect(await ingots("alpha")).toEqual({ available: 1, escrow: 0 });
    expect((await readMarketDiagnostics(db, guildId)).inventory).toBe("2499");
    expect(await db.steamKey.findFirst({ where: { guildId, offerSlug: "test-key" } })).toMatchObject({ status: "available" });

    const again = await buyOffer(db, { guildId, userId: "alpha", offerSlug: "test-key", idempotencyKey: "key-deliver", now });
    if (again.result !== "ready") {
      throw new Error(again.result);
    }
    const delivered = await deliverPurchase(db, { guildId, userId: "alpha", purchaseId: again.purchaseId, now });
    expect(delivered).toMatchObject({ result: "delivered", dmStatus: "setup_required" });
    expect(await ingots("alpha")).toEqual({ available: 0, escrow: 0 });
    const afterCommit = await readMarketDiagnostics(db, guildId);
    expect(afterCommit.inventory).toBe("2500");
    expect(afterCommit.backing).toBe(backing);
    expect(afterCommit.conserved).toBe(true);
    expect(await deliverPurchase(db, { guildId, userId: "alpha", purchaseId: again.purchaseId, now })).toMatchObject({ result: "already_recorded" });
    const inbox = await db.deliveryInbox.findUnique({ where: { purchaseId: again.purchaseId } });
    expect(inbox?.summary).toBe(PRIVATE_INBOX_DETAIL);
    expect(JSON.stringify(inbox)).not.toContain(secret);
    const revealed = await revealPurchase(db, { guildId, userId: "alpha", purchaseId: again.purchaseId, now: later });
    expect(revealed).toMatchObject({ result: "ready", key: secret });
    expect(await revealPurchase(db, { guildId, userId: "alpha", purchaseId: again.purchaseId, now: later })).toMatchObject({ result: "ready", key: secret });
    expect(await db.steamKey.count({ where: { guildId, offerSlug: "test-key", status: "revealed" } })).toBe(1);
    expect(await refundPurchase(db, { guildId, userId: "alpha", purchaseId: again.purchaseId, now: later })).toMatchObject({ result: "review" });
    expect(await reviewRefund(db, { guildId, actorUserId: "owner", actorRoleIds: staff, purchaseId: again.purchaseId, now: later })).toMatchObject({ result: "recorded", restored: false });
    expect(await db.steamKey.findFirst({ where: { guildId, offerSlug: "test-key" } })).toMatchObject({ status: "revealed" });
    expect((await readMarketDiagnostics(db, guildId)).inventory).toBe("2500");

    const staffView = await readShopStaff(db, guildId);
    const audits = await db.auditRecord.findMany({ where: { guildId } });
    const purchases = await db.shopPurchase.findMany({ where: { guildId } });
    expect(JSON.stringify({ staffView, audits, purchases, inbox })).not.toContain(secret);

    expect(await saveShopOffer(db, { guildId, actorUserId: "owner", actorRoleIds: staff, slug: "parade-frame", name: "Parade frame", shop: "supply", currency: "marks", price: 5, stock: 2, limitPerMember: 0, minLevel: 1, requiredRoleId: "", classSlug: "", deliverable: "cosmetic", deliverableSlug: "parade-frame", amount: 1, duplicatePolicy: "salvage" })).toMatchObject({ result: "saved" });
    expect(await buyOffer(db, { guildId, userId: "alpha", offerSlug: "parade-frame", idempotencyKey: "frame-1", now })).toMatchObject({ result: "ready" });
    expect(await buyOffer(db, { guildId, userId: "alpha", offerSlug: "parade-frame", idempotencyKey: "frame-2", now })).toMatchObject({ result: "ready" });
    expect(await db.cosmeticItem.count({ where: { guildId, userId: "alpha", slug: "parade-frame", destroyed: false } })).toBe(1);

    expect(await saveCrateTable(db, { guildId, actorUserId: "owner", actorRoleIds: staff, slug: "bad-crate", name: "Bad", currency: "marks", price: 10, pityThreshold: 2, guaranteeSlug: "steam-key", entries: [{ slug: "steam-key", kind: "steam_key", weight: 1, amount: 1, duplicatePolicy: "keep", guarantee: true }] })).toMatchObject({ result: "invalid" });
    expect(await saveCrateTable(db, {
      guildId,
      actorUserId: "owner",
      actorRoleIds: staff,
      slug: "pity-crate",
      name: "Pity crate",
      currency: "marks",
      price: 10,
      pityThreshold: 2,
      guaranteeSlug: "night-glass",
      entries: [
        { slug: "night-glass", kind: "cosmetic", weight: 1, amount: 1, duplicatePolicy: "salvage", guarantee: true },
        { slug: "scrap", kind: "material", weight: 10, amount: 1, duplicatePolicy: "keep", guarantee: false },
      ],
    })).toMatchObject({ result: "saved", version: 1 });
    const firstGrant = await grantCrate(db, { guildId, userId: "alpha", tableSlug: "pity-crate", source: "expedition", idempotencyKey: "pity-1", roll: 2 });
    const secondGrant = await grantCrate(db, { guildId, userId: "alpha", tableSlug: "pity-crate", source: "expedition", idempotencyKey: "pity-2", roll: 2 });
    expect(firstGrant).toMatchObject({ result: "ready", outcome: { slug: "scrap", amount: 1, tableVersion: 1 } });
    expect(secondGrant).toMatchObject({ result: "ready", outcome: { slug: "night-glass", converted: false, tableVersion: 1 } });
    expect(await grantCrate(db, { guildId, userId: "alpha", tableSlug: "pity-crate", source: "expedition", idempotencyKey: "pity-1", roll: 99 })).toMatchObject({ result: "already_recorded", outcome: { slug: "scrap", amount: 1 } });
    if (firstGrant.result !== "ready") {
      throw new Error(firstGrant.result);
    }
    expect(await openCrate(db, { guildId, userId: "alpha", grantId: firstGrant.grantId })).toMatchObject({ outcome: { slug: "scrap", amount: 1, tableVersion: 1 } });
    expect(await openCrate(db, { guildId, userId: "alpha", grantId: firstGrant.grantId })).toMatchObject({ outcome: { slug: "scrap", amount: 1, tableVersion: 1 } });
    await grantCrate(db, { guildId, userId: "alpha", tableSlug: "pity-crate", source: "contract", idempotencyKey: "pity-3", roll: 2 });
    const converted = await grantCrate(db, { guildId, userId: "alpha", tableSlug: "pity-crate", source: "event", idempotencyKey: "pity-4", roll: 2 });
    expect(converted).toMatchObject({ outcome: { slug: "scrap", converted: true, amount: 2 } });
    expect(await db.cosmeticItem.count({ where: { guildId, userId: "alpha", slug: "night-glass", destroyed: false } })).toBe(1);
    expect(await saveCrateTable(db, {
      guildId,
      actorUserId: "owner",
      actorRoleIds: staff,
      slug: "pity-crate",
      name: "Pity crate",
      currency: "marks",
      price: 10,
      pityThreshold: 2,
      guaranteeSlug: "night-glass",
      entries: [
        { slug: "night-glass", kind: "cosmetic", weight: 1, amount: 1, duplicatePolicy: "salvage", guarantee: true },
        { slug: "scrap", kind: "material", weight: 10, amount: 4, duplicatePolicy: "keep", guarantee: false },
      ],
    })).toMatchObject({ result: "saved", version: 2 });
    expect(await db.crateGrant.findUnique({ where: { id: firstGrant.grantId } })).toMatchObject({ outcome: { amount: 1, tableVersion: 1 } });
    const versioned = await grantCrate(db, { guildId, userId: "alpha", tableSlug: "pity-crate", source: "shop", idempotencyKey: "pity-5", roll: 2 });
    expect(versioned).toMatchObject({ outcome: { slug: "scrap", amount: 4, tableVersion: 2 } });
    const preview = await previewCrate(db, { guildId, userId: "alpha", tableSlug: "pity-crate" });
    expect(preview).toMatchObject({ result: "preview", version: 2, policy: "roll_at_acquisition", pity: 1, versionSeen: 2 });
    expect(JSON.stringify(preview)).not.toContain("\"outcome\"");
    expect(preview.result === "preview" ? preview.odds.reduce((sum, entry) => sum + entry.basisPoints, 0) : 0).toBe(10000);

    const giveawayKey = "GIVEAWAY-SECRET-77";
    expect(await importSteamKey(db, { guildId, actorUserId: "owner", actorRoleIds: staff, offerSlug: "steam-key", keyMaterial: giveawayKey, now })).toMatchObject({ result: "stocked" });
    const prize = await savePrizeStock(db, { guildId, actorUserId: "owner", actorRoleIds: staff, name: "Steam key", kind: "external_key", onHand: 0, now });
    if (prize.result !== "stocked") {
      throw new Error(prize.result);
    }
    const opened = await createGiveaway(db, { guildId, actorUserId: "owner", actorRoleIds: staff, title: "Key", rules: "One free entry.", bonusRules: "No bonus entries.", closesAt: later, maxBonus: 0, stockId: prize.stock.id, now });
    if (opened.result !== "open") {
      throw new Error(opened.result);
    }
    await enterGiveaway(db, { guildId, giveawayId: opened.giveaway.id, userId: "beta", roleIds: [], accountAgeDays: 40, now });
    await closeGiveaway(db, { guildId, actorUserId: "owner", actorRoleIds: staff, giveawayId: opened.giveaway.id, now });
    const drawn = await drawGiveaway(db, { guildId, actorUserId: "owner", actorRoleIds: staff, giveawayId: opened.giveaway.id, randomIndex: () => 0, now });
    if (drawn.result !== "drawn" || !drawn.draws[0]) {
      throw new Error(drawn.result);
    }
    const claimed = await claimGiveaway(db, { guildId, drawId: drawn.draws[0].id, userId: "beta", now });
    expect(claimed).toMatchObject({ result: "claimed", fulfilment: "fulfilled", detail: PRIVATE_INBOX_DETAIL });
    expect(JSON.stringify(claimed)).not.toContain(giveawayKey);
    const fulfilment = await db.prizeFulfilment.findFirst({ where: { guildId, sourceId: opened.giveaway.id } });
    expect(JSON.stringify(fulfilment)).not.toContain(giveawayKey);
    expect(await claimGiveaway(db, { guildId, drawId: drawn.draws[0].id, userId: "beta", now })).toMatchObject({ result: "already_claimed" });
    expect(await db.steamKey.count({ where: { guildId, offerSlug: "steam-key", status: "assigned" } })).toBe(1);
    expect(await db.shopOffer.findUnique({ where: { guildId_slug: { guildId, slug: "steam-key" } } })).toMatchObject({ stock: 0 });
  });
});
