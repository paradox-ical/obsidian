import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { chooseClass } from "./characters.js";
import { createPrismaClient } from "./client.js";
import { equipGear, mintGear } from "./combat.js";
import { assignContract, saveContractObjective } from "./contracts.js";
import { fundExceptional, issueMarks } from "./ledger.js";
import { grantCapability } from "./platform.js";
import {
  applyReroll,
  applyUpgrade,
  buyListing,
  cancelTrade,
  confirmSalvage,
  confirmTrade,
  craftItem,
  editTrade,
  inspectTrade,
  listItem,
  offerTrade,
  previewReroll,
  previewSalvage,
  saveRecipe,
  saveWorkshopCaps,
  sweepWorkshop,
} from "./workshop.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.");
}

const db = createPrismaClient(databaseUrl);
const guildId = `guild-${randomUUID()}`;
const now = new Date("2026-10-12T02:00:00.000Z");
const staff = ["staff"];

async function marks(userId: string) {
  const wallet = await db.wallet.findUnique({ where: { guildId_userId_currency: { guildId, userId, currency: "marks" } } });
  return { available: Number(wallet?.availableMinor ?? 0n) / 100, escrow: Number(wallet?.escrowMinor ?? 0n) / 100 };
}

async function scrap(userId: string) {
  const row = await db.materialStock.findUnique({ where: { guildId_userId_slug: { guildId, userId, slug: "scrap" } } });
  return row?.quantity ?? 0;
}

async function gear(templateSlug: string, userId: string, key: string, affixes: Array<{ slug: string; stat: "damage" | "accuracy"; amount: number }> = [{ slug: "honed", stat: "damage", amount: 1 }]) {
  const minted = await mintGear(db, { guildId, userId, templateSlug, affixes, idempotencyKey: key });
  if (minted.result !== "minted") {
    throw new Error(minted.result);
  }
  return minted.itemId;
}

afterAll(async () => {
  await db.marketListing.deleteMany({ where: { guildId } });
  await db.tradeOffer.deleteMany({ where: { guildId } });
  await db.craftRecipe.deleteMany({ where: { guildId } });
  await db.materialStock.deleteMany({ where: { guildId } });
  await db.workshopSettings.deleteMany({ where: { guildId } });
  await db.pvpReview.deleteMany({ where: { guildId } });
  await db.pvpMatch.deleteMany({ where: { guildId } });
  await db.pvpQueueEntry.deleteMany({ where: { guildId } });
  await db.pvpRating.deleteMany({ where: { guildId } });
  await db.battleAction.deleteMany({ where: { guildId } });
  await db.battleRoll.deleteMany({ where: { guildId } });
  await db.battle.deleteMany({ where: { guildId } });
  await db.gearInstance.deleteMany({ where: { guildId } });
  await db.gearTemplate.deleteMany({ where: { guildId } });
  await db.testOpponent.deleteMany({ where: { guildId } });
  await db.job.deleteMany({ where: { guildId } });
  await db.contractSubmission.deleteMany({ where: { guildId } });
  await db.contractNotice.deleteMany({ where: { guildId } });
  await db.contractAssignment.deleteMany({ where: { guildId } });
  await db.contractReroll.deleteMany({ where: { guildId } });
  await db.contractPreference.deleteMany({ where: { guildId } });
  await db.contractBoardSlot.deleteMany({ where: { guildId } });
  await db.contractCursor.deleteMany({ where: { guildId } });
  await db.contractRevision.deleteMany({ where: { guildId } });
  await db.contractDefinition.deleteMany({ where: { guildId } });
  await db.contractSettings.deleteMany({ where: { guildId } });
  await db.characterXpEvent.deleteMany({ where: { guildId } });
  await db.playerCharacter.deleteMany({ where: { guildId } });
  await db.classAbility.deleteMany({ where: { guildId } });
  await db.classDefinition.deleteMany({ where: { guildId } });
  await db.characterCurve.deleteMany({ where: { guildId } });
  await db.seasonArchive.deleteMany({ where: { guildId } });
  await db.seasonState.deleteMany({ where: { guildId } });
  await db.seasonSettings.deleteMany({ where: { guildId } });
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

describe("trades, marketplace escrow, and gear progression", () => {
  it("settles one copy of an item, clears a trade edit, and conserves materials", async () => {
    await grantCapability(db, { guildId, roleId: "staff", capability: "event_management", actorUserId: "owner", reason: "test" });
    await grantCapability(db, { guildId, roleId: "staff", capability: "content_management", actorUserId: "owner", reason: "test" });
    await grantCapability(db, { guildId, roleId: "staff", capability: "economy_operations", actorUserId: "owner", reason: "test" });
    expect(await fundExceptional(db, { guildId, amountMarks: 800, idempotencyKey: "workshop-pool", reason: "Workshop test", actorUserId: "owner", actorRoleIds: staff, now })).toMatchObject({ result: "funded" });
    for (const userId of ["alpha", "beta", "gamma"]) {
      expect(await chooseClass(db, { guildId, userId, classSlug: "hitman", now })).toMatchObject({ result: "chosen" });
      expect(await issueMarks(db, { guildId, userId, amountMarks: 200, source: "workshop.test", sourceId: userId, pace: "exceptional", idempotencyKey: `fund:${userId}`, reason: "Workshop test", actorUserId: "owner", now })).toMatchObject({ result: "posted" });
    }

    const tradeA = await gear("field-knife", "alpha", "trade-a");
    const tradeB = await gear("field-knife", "beta", "trade-b", [{ slug: "keen", stat: "accuracy", amount: 2 }]);
    const preview = await previewReroll(db, { guildId, userId: "alpha", itemId: tradeA, affix: "honed" });
    expect(preview).toMatchObject({ result: "preview", min: 1, max: 2, marks: 10, rerollCount: 0 });
    const rolled = await applyReroll(db, { guildId, userId: "alpha", itemId: tradeA, affix: "honed", now });
    expect(rolled.result).toBe("ready");
    if (rolled.result !== "ready") {
      return;
    }
    expect(rolled.amount).toBeGreaterThanOrEqual(1);
    expect(rolled.amount).toBeLessThanOrEqual(2);
    expect(rolled.rerollCount).toBe(1);
    expect(await marks("alpha")).toEqual({ available: 190, escrow: 0 });

    const before = (await marks("alpha")).available + (await marks("beta")).available;
    const offered = await offerTrade(db, { guildId, userId: "alpha", otherUserId: "beta", offerItemId: tradeA, requestItemId: tradeB, offerMarks: 10, requestMarks: 0, now });
    expect(offered).toMatchObject({ result: "ready", fromConfirmed: false, toConfirmed: false });
    if (offered.result !== "ready") {
      return;
    }
    const inspected = await inspectTrade(db, { guildId, userId: "beta", tradeId: offered.tradeId });
    expect(inspected.result).toBe("ready");
    if (inspected.result !== "ready") {
      return;
    }
    expect(inspected.items.find((item) => item.id === tradeA)).toMatchObject({ rerollCount: 1, upgradeTier: 0 });
    expect(await confirmTrade(db, { guildId, userId: "beta", tradeId: offered.tradeId, now })).toMatchObject({ result: "waiting", toConfirmed: true, fromConfirmed: false });
    expect(await confirmTrade(db, { guildId, userId: "alpha", tradeId: offered.tradeId, now })).toMatchObject({ result: "ready", status: "settled" });
    expect(await confirmTrade(db, { guildId, userId: "alpha", tradeId: offered.tradeId, now })).toMatchObject({ result: "closed" });
    expect(await db.gearInstance.findUnique({ where: { id: tradeA } })).toMatchObject({ userId: "beta", rerollCount: 1, lock: "", destroyed: false });
    expect(await db.gearInstance.findUnique({ where: { id: tradeB } })).toMatchObject({ userId: "alpha", lock: "" });
    expect((await marks("alpha")).available + (await marks("beta")).available).toBe(before);
    expect(await marks("alpha")).toEqual({ available: 180, escrow: 0 });
    expect(await marks("beta")).toEqual({ available: 210, escrow: 0 });
    expect(await db.ledgerEntry.count({ where: { sourceId: `trade-pay:${offered.tradeId}` } })).toBe(2);

    const editA = await gear("field-knife", "alpha", "edit-a");
    const editB = await gear("field-knife", "beta", "edit-b");
    const editable = await offerTrade(db, { guildId, userId: "alpha", otherUserId: "beta", offerItemId: editA, requestItemId: editB, offerMarks: 0, requestMarks: 0, now });
    if (editable.result !== "ready") {
      throw new Error(editable.result);
    }
    expect(await confirmTrade(db, { guildId, userId: "beta", tradeId: editable.tradeId, now })).toMatchObject({ result: "waiting" });
    const edited = await editTrade(db, { guildId, userId: "alpha", tradeId: editable.tradeId, offerItemId: editA, requestItemId: editB, offerMarks: 5, requestMarks: 0, now });
    expect(edited).toMatchObject({ result: "ready", version: 2, fromConfirmed: false, toConfirmed: false, offerMarks: 5 });
    expect(await confirmTrade(db, { guildId, userId: "beta", tradeId: editable.tradeId, now })).toMatchObject({ result: "waiting", status: "proposed" });
    expect(await db.gearInstance.findUnique({ where: { id: editA } })).toMatchObject({ userId: "alpha" });
    expect(await confirmTrade(db, { guildId, userId: "alpha", tradeId: editable.tradeId, now })).toMatchObject({ status: "settled" });
    expect(await db.gearInstance.findUnique({ where: { id: editA } })).toMatchObject({ userId: "beta", rerollCount: 0 });
    expect(await marks("alpha")).toEqual({ available: 175, escrow: 0 });

    const raceItem = await gear("field-knife", "alpha", "race-item");
    const raced = await Promise.all([
      offerTrade(db, { guildId, userId: "alpha", otherUserId: "beta", offerItemId: raceItem, requestItemId: "", offerMarks: 0, requestMarks: 0, now }),
      offerTrade(db, { guildId, userId: "alpha", otherUserId: "gamma", offerItemId: raceItem, requestItemId: "", offerMarks: 0, requestMarks: 0, now }),
    ]);
    expect(raced.filter((row) => row.result === "ready")).toHaveLength(1);
    expect(raced.filter((row) => row.result === "locked")).toHaveLength(1);
    expect(await db.tradeOffer.count({ where: { guildId, offerItemId: raceItem, status: "proposed" } })).toBe(1);
    const raceTrade = raced.find((row) => row.result === "ready");
    if (raceTrade?.result === "ready") {
      expect(await cancelTrade(db, { guildId, userId: "alpha", tradeId: raceTrade.tradeId, now })).toMatchObject({ result: "cancelled" });
    }
    expect(await db.gearInstance.findUnique({ where: { id: raceItem } })).toMatchObject({ userId: "alpha", lock: "" });

    const bound = await gear("suppressed-rifle", "alpha", "bound-rifle", []);
    expect(await offerTrade(db, { guildId, userId: "alpha", otherUserId: "beta", offerItemId: bound, offerMarks: 0, requestMarks: 0, now })).toMatchObject({ result: "bound" });
    const equipped = await gear("field-knife", "alpha", "equipped");
    expect(await equipGear(db, { guildId, userId: "alpha", itemId: equipped })).toMatchObject({ result: "equipped" });
    expect(await offerTrade(db, { guildId, userId: "alpha", otherUserId: "beta", offerItemId: equipped, offerMarks: 0, requestMarks: 0, now })).toMatchObject({ result: "equipped" });
    expect(await applyReroll(db, { guildId, userId: "alpha", itemId: equipped, affix: "honed", now })).toMatchObject({ result: "equipped" });
    const locked = await gear("field-knife", "alpha", "locked-item");
    await db.gearInstance.update({ where: { id: locked }, data: { lock: "expedition" } });
    expect(await offerTrade(db, { guildId, userId: "alpha", otherUserId: "beta", offerItemId: locked, offerMarks: 0, requestMarks: 0, now })).toMatchObject({ result: "locked" });
    expect(await applyReroll(db, { guildId, userId: "alpha", itemId: locked, affix: "honed", now })).toMatchObject({ result: "locked" });
    await db.gearInstance.update({ where: { id: locked }, data: { lock: "combat" } });
    expect(await applyUpgrade(db, { guildId, userId: "alpha", itemId: locked, now })).toMatchObject({ result: "locked" });

    const listedItem = await gear("field-knife", "alpha", "listed");
    const sellerBefore = (await marks("alpha")).available;
    const betaBefore = (await marks("beta")).available;
    const gammaBefore = (await marks("gamma")).available;
    const listed = await listItem(db, { guildId, userId: "alpha", itemId: listedItem, priceMarks: 20, now });
    if (listed.result !== "ready") {
      throw new Error(listed.result);
    }
    const bought = await Promise.all([
      buyListing(db, { guildId, userId: "beta", listingId: listed.listingId, now }),
      buyListing(db, { guildId, userId: "gamma", listingId: listed.listingId, now }),
    ]);
    expect(bought.filter((row) => row.result === "ready")).toHaveLength(1);
    expect(bought.filter((row) => row.result === "closed")).toHaveLength(1);
    const ownedBy = (await db.gearInstance.findUnique({ where: { id: listedItem } }))?.userId;
    expect(ownedBy === "beta" || ownedBy === "gamma").toBe(true);
    expect(await db.gearInstance.findUnique({ where: { id: listedItem } })).toMatchObject({ lock: "", destroyed: false, rerollCount: 0 });
    expect(await marks("alpha")).toEqual({ available: sellerBefore + 20, escrow: 0 });
    expect(await marks(ownedBy === "beta" ? "beta" : "gamma")).toEqual({ available: (ownedBy === "beta" ? betaBefore : gammaBefore) - 20, escrow: 0 });
    expect(await marks(ownedBy === "beta" ? "gamma" : "beta")).toEqual({ available: ownedBy === "beta" ? gammaBefore : betaBefore, escrow: 0 });
    expect(await db.ledgerEntry.count({ where: { sourceId: `listing-pay:${listed.listingId}` } })).toBe(2);
    expect(await buyListing(db, { guildId, userId: ownedBy === "beta" ? "gamma" : "beta", listingId: listed.listingId, now })).toMatchObject({ result: "closed" });

    const expireItem = await gear("field-knife", "alpha", "expire-item");
    const expiring = await listItem(db, { guildId, userId: "alpha", itemId: expireItem, priceMarks: 15, now });
    if (expiring.result !== "ready") {
      throw new Error(expiring.result);
    }
    const alphaBeforeExpiry = (await marks("alpha")).available;
    await sweepWorkshop(db, new Date(expiring.expiresAt));
    expect(await db.marketListing.findUnique({ where: { id: expiring.listingId } })).toMatchObject({ status: "expired" });
    expect(await db.gearInstance.findUnique({ where: { id: expireItem } })).toMatchObject({ userId: "alpha", lock: "" });
    expect(await marks("alpha")).toEqual({ available: alphaBeforeExpiry, escrow: 0 });
    expect(await sweepWorkshop(db, new Date(expiring.expiresAt))).toEqual({ expiredTrades: 0, expiredListings: 0 });

    const firstScrap = await gear("field-knife", "alpha", "scrap-1");
    const secondScrap = await gear("field-knife", "alpha", "scrap-2");
    expect(await previewSalvage(db, { guildId, userId: "alpha", itemId: firstScrap })).toMatchObject({ result: "preview", material: "scrap", amount: 1, destroyed: false });
    expect(await db.gearInstance.findUnique({ where: { id: firstScrap } })).toMatchObject({ destroyed: false });
    expect(await confirmSalvage(db, { guildId, userId: "alpha", itemId: firstScrap, now })).toMatchObject({ result: "destroyed", amount: 1 });
    expect(await confirmSalvage(db, { guildId, userId: "alpha", itemId: secondScrap, now })).toMatchObject({ result: "destroyed", amount: 1 });
    expect(await scrap("alpha")).toBe(2);
    const objective = await saveContractObjective(db, { guildId, actorUserId: "owner", actorRoleIds: staff, title: "Craft once", prompt: "Craft one recipe.", kind: "rpg_crafting", target: 1, rewardMarks: 10, now });
    if (objective.result !== "saved") {
      throw new Error(objective.result);
    }
    const assignment = await assignContract(db, { guildId, actorUserId: "owner", actorRoleIds: staff, userId: "alpha", definitionId: objective.objectiveId, board: "daily", now });
    if (assignment.result !== "assigned") {
      throw new Error(assignment.result);
    }
    const crafted = await Promise.all([
      craftItem(db, { guildId, userId: "alpha", recipeSlug: "honed-knife", idempotencyKey: "craft-once", now }),
      craftItem(db, { guildId, userId: "alpha", recipeSlug: "honed-knife", idempotencyKey: "craft-once", now }),
    ]);
    expect(crafted.filter((row) => row.result === "ready" || row.result === "already_recorded").length).toBeGreaterThan(0);
    expect(await db.gearInstance.count({ where: { idempotencyKey: "craft-once" } })).toBe(1);
    expect(await scrap("alpha")).toBe(0);
    const made = await db.gearInstance.findFirst({ where: { idempotencyKey: "craft-once" } });
    expect(made).toMatchObject({ userId: "alpha", provenance: "craft:honed-knife:v1", rerollCount: 0, upgradeTier: 0, destroyed: false, affixes: [{ slug: "honed", stat: "damage", amount: 1 }] });
    expect(await craftItem(db, { guildId, userId: "alpha", recipeSlug: "honed-knife", idempotencyKey: "craft-second", now })).toMatchObject({ result: "insufficient" });
    expect(await scrap("alpha")).toBe(0);
    expect(await db.contractAssignment.findUnique({ where: { id: assignment.assignment.id } })).toMatchObject({ status: "completed" });
    expect(await db.ledgerEntry.count({ where: { idempotencyKey: assignment.assignment.rewardKey } })).toBe(1);

    const upgradeScrap = await gear("field-knife", "alpha", "upgrade-scrap");
    const upgradeItem = await gear("field-knife", "alpha", "upgrade-item");
    expect(await confirmSalvage(db, { guildId, userId: "alpha", itemId: upgradeScrap, now })).toMatchObject({ result: "destroyed" });
    const beforeUpgrade = await marks("alpha");
    expect(await applyUpgrade(db, { guildId, userId: "alpha", itemId: upgradeItem, now })).toMatchObject({ result: "ready", tier: 1, destroyed: false });
    expect(await scrap("alpha")).toBe(0);
    expect(await marks("alpha")).toEqual({ available: beforeUpgrade.available - 25, escrow: 0 });
    expect(await db.gearInstance.findUnique({ where: { id: upgradeItem } })).toMatchObject({ destroyed: false, upgradeTier: 1, upgradeHistory: [{ tier: 1, at: now.toISOString() }] });
    expect(await applyUpgrade(db, { guildId, userId: "alpha", itemId: upgradeItem, now })).toMatchObject({ result: "insufficient" });
    expect(await db.gearInstance.findUnique({ where: { id: upgradeItem } })).toMatchObject({ upgradeTier: 1, destroyed: false });

    expect(await saveWorkshopCaps(db, { guildId, actorUserId: "owner", actorRoleIds: staff, upgradeCap: 2, listingLimit: 2, listingHours: 48, listingFeeMarks: 0, rerollBaseMarks: 12 })).toMatchObject({ result: "saved" });
    expect(await saveRecipe(db, { guildId, actorUserId: "owner", actorRoleIds: staff, slug: "keen-knife", name: "Keen knife", outputSlug: "field-knife", inputAmount: 1, affixSlug: "keen", affixStat: "accuracy", affixAmount: 2 })).toMatchObject({ result: "saved" });
    expect(await db.craftRecipe.findUnique({ where: { guildId_slug: { guildId, slug: "honed-knife" } } })).toMatchObject({ status: "active" });
  });
});
