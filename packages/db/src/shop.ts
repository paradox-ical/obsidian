import { randomInt, randomUUID } from "node:crypto";

import {
  CRATE_POLICY,
  DUPLICATE_SCRAP,
  FIELD_CRATE_MARKS,
  FIELD_PITY,
  PRIVATE_INBOX_DETAIL,
  SHOP_RULES,
  STEAM_KEY_INGOTS,
  VAULT_CRATE_INGOTS,
  VAULT_PITY,
  affixDecision,
  crateTableDecision,
  marksToMinor,
  offerOpen,
  pityDue,
  publishedOdds,
  shopPriceDecision,
  type AffixRoll,
  type AffixRule,
} from "@collective/domain";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

import { ensureGearCatalog } from "./combat.js";
import { moveHeldCurrency } from "./ledger.js";
import { applyShopIngotMove } from "./market.js";
import { actorCan, ensureGuild, moduleIsAvailable, writeAudit, type Writer } from "./platform.js";
import { openShopKey, sealShopKey, shopKeySecretReady } from "./shop-secret.js";

type Tx = Prisma.TransactionClient;
type Root = PrismaClient;

class Halt extends Error {
  constructor(readonly outcome: "insufficient" | "missing" | "invalid" | "limit" | "level" | "denied" | "closed" | "review") {
    super(outcome);
  }
}

interface StoredOutcome {
  kind: string;
  slug: string;
  amount: number;
  converted: boolean;
  tableVersion: number;
  name: string;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
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

function asOutcome(value: unknown): StoredOutcome | null {
  if (!value || typeof value !== "object" || !("kind" in value) || !("slug" in value) || !("amount" in value)) {
    return null;
  }
  const kind = String(value.kind);
  const slug = String(value.slug);
  const amount = Number(value.amount);
  const converted = "converted" in value && value.converted === true;
  const tableVersion = "tableVersion" in value ? Number(value.tableVersion) : 1;
  const name = "name" in value ? String(value.name) : slug;
  return { kind, slug, amount, converted, tableVersion, name };
}

async function openEconomy(db: Writer, guildId: string) {
  await ensureGuild(db, { guildId });
  return moduleIsAvailable(db, guildId, "economy");
}

async function ensureShop(db: Writer, guildId: string) {
  await ensureGearCatalog(db, guildId);
  const offers = [
    ["field-knife", "supply", "Field knife", "A basic blade.", "marks", 50, 5, 2, "gear", "field-knife", 1, "keep", null],
    ["scrap-bundle", "supply", "Scrap bundle", "Two scrap.", "marks", 20, 10, 0, "material", "scrap", 2, "keep", null],
    ["field-crate", "supply", "Field crate", "Marks crate. The result is stored at purchase.", "marks", FIELD_CRATE_MARKS, 8, 0, "crate", "field-crate", 1, "keep", null],
    ["later-ration", "supply", "Later ration", "A rotating supply offer.", "marks", 15, 4, 0, "service", "ration", 1, "keep", new Date("2027-01-01T00:00:00.000Z")],
    ["steam-key", "ingot", "Steam key", "Direct Ingot shop only.", "ingots", STEAM_KEY_INGOTS, 0, 1, "steam_key", "steam-key", 1, "keep", null],
    ["night-glass", "ingot", "Night glass", "A rare cosmetic. A duplicate is salvaged.", "ingots", 2, 5, 0, "cosmetic", "night-glass", 1, "salvage", null],
    ["vault-crate", "ingot", "Vault crate", "High-end crate. No Steam keys.", "ingots", VAULT_CRATE_INGOTS, 4, 0, "crate", "vault-crate", 1, "keep", null],
  ] as const;
  for (const [slug, shop, name, description, currency, price, stock, limitPerMember, deliverable, deliverableSlug, amount, duplicatePolicy, startsAt] of offers) {
    const existing = await db.shopOffer.findUnique({ where: { guildId_slug: { guildId, slug } } });
    if (existing) {
      continue;
    }
    await db.shopOffer.create({
      data: { id: randomUUID(), guildId, shop, slug, name, description, currency, price, stock, limitPerMember, deliverable, deliverableSlug, amount, duplicatePolicy, startsAt, status: "active", version: 1 },
    });
  }
  await ensureTable(db, guildId, {
    slug: "field-crate",
    name: "Field crate",
    currency: "marks",
    price: FIELD_CRATE_MARKS,
    pityThreshold: FIELD_PITY,
    guaranteeSlug: "night-glass",
    entries: [
      { slug: "scrap", kind: "material", weight: 70, amount: 2, duplicatePolicy: "keep", guarantee: false },
      { slug: "field-knife", kind: "gear", weight: 25, amount: 1, duplicatePolicy: "keep", guarantee: false },
      { slug: "night-glass", kind: "cosmetic", weight: 5, amount: 1, duplicatePolicy: "salvage", guarantee: true },
    ],
  });
  await ensureTable(db, guildId, {
    slug: "vault-crate",
    name: "Vault crate",
    currency: "ingots",
    price: VAULT_CRATE_INGOTS,
    pityThreshold: VAULT_PITY,
    guaranteeSlug: "night-glass",
    entries: [
      { slug: "scrap", kind: "material", weight: 50, amount: 3, duplicatePolicy: "keep", guarantee: false },
      { slug: "field-knife", kind: "gear", weight: 30, amount: 1, duplicatePolicy: "keep", guarantee: false },
      { slug: "night-glass", kind: "cosmetic", weight: 20, amount: 1, duplicatePolicy: "salvage", guarantee: true },
    ],
  });
}

async function ensureTable(db: Writer, guildId: string, input: { slug: string; name: string; currency: string; price: number; pityThreshold: number; guaranteeSlug: string; entries: Array<{ slug: string; kind: string; weight: number; amount: number; duplicatePolicy: string; guarantee: boolean }> }) {
  const existing = await db.crateTable.findUnique({ where: { guildId_slug: { guildId, slug: input.slug } } });
  if (existing) {
    return;
  }
  const id = randomUUID();
  await db.crateTable.create({
    data: { id, guildId, slug: input.slug, name: input.name, version: 1, currency: input.currency, price: input.price, pityThreshold: input.pityThreshold, guaranteeSlug: input.guaranteeSlug, policy: CRATE_POLICY, status: "active", replacesSlug: "" },
  });
  await db.crateEntry.createMany({
    data: input.entries.map((entry) => ({ id: randomUUID(), guildId, tableId: id, ...entry })),
  });
}

function receipt(name: string, amount: number, currency: string, status: string, purchaseId: string) {
  return `Receipt ${purchaseId} for ${name}. ${amount} ${currency}. Status ${status}.`;
}

async function payMarks(tx: Tx, guildId: string, userId: string, marks: number, key: string, refund: boolean, now: Date) {
  const amountMinor = marksToMinor(marks);
  if (amountMinor === null || amountMinor <= 0n) {
    return "invalid" as const;
  }
  return moveHeldCurrency(tx, {
    guildId,
    userId,
    currency: "marks",
    availableDelta: refund ? amountMinor : -amountMinor,
    escrowDelta: 0n,
    kind: refund ? "shop_refund" : "shop_spend",
    direction: refund ? "credit" : "debit",
    amountMinor,
    source: "shop",
    sourceId: key,
    pace: "market",
    idempotencyKey: key,
    reason: refund ? "Shop refund" : "Shop purchase",
    actorUserId: userId,
    now,
  });
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

async function mintTemplate(tx: Tx, guildId: string, userId: string, templateSlug: string, key: string) {
  const existing = await tx.gearInstance.findUnique({ where: { idempotencyKey: key } });
  if (existing) {
    return existing.id;
  }
  const template = await tx.gearTemplate.findUnique({ where: { guildId_slug: { guildId, slug: templateSlug } } });
  if (!template || template.status !== "active") {
    throw new Halt("missing");
  }
  const rules = asRules(template.affixRules);
  const affixes: AffixRoll[] = rules[0] ? [{ slug: rules[0].slug, stat: rules[0].stat, amount: rules[0].min }] : [];
  if (affixDecision(rules, affixes, template.affixMax) !== "allowed") {
    throw new Halt("invalid");
  }
  const item = await tx.gearInstance.create({
    data: {
      id: randomUUID(),
      guildId,
      userId,
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
      provenance: `shop:${templateSlug}`,
      equipped: false,
      lock: "",
      destroyed: false,
      templateVersion: template.version,
      idempotencyKey: key,
    },
  });
  return item.id;
}

async function giveCosmetic(tx: Tx, guildId: string, userId: string, slug: string, policy: string, key: string) {
  const owned = await tx.cosmeticItem.count({ where: { guildId, userId, slug, destroyed: false } });
  if (policy === "salvage" && owned > 0) {
    if (!(await changeMaterial(tx, guildId, userId, "scrap", DUPLICATE_SCRAP))) {
      throw new Halt("invalid");
    }
    return { converted: true, amount: DUPLICATE_SCRAP };
  }
  await tx.cosmeticItem.create({
    data: { id: randomUUID(), guildId, userId, slug, name: slug, binding: policy === "trade" ? "tradable" : "bound", provenance: "shop", idempotencyKey: key },
  });
  return { converted: false, amount: 1 };
}

async function lockPity(tx: Tx, guildId: string, userId: string, tableSlug: string) {
  await tx.$executeRaw`
    INSERT INTO "crate_pity" ("id", "guildId", "userId", "tableSlug", "count", "versionSeen")
    VALUES (${randomUUID()}, ${guildId}, ${userId}, ${tableSlug}, 0, 1)
    ON CONFLICT ("guildId", "userId", "tableSlug") DO NOTHING
  `;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "crate_pity"
    WHERE "guildId" = ${guildId} AND "userId" = ${userId} AND "tableSlug" = ${tableSlug}
    FOR UPDATE
  `;
  return rows[0] ? tx.cratePity.findUnique({ where: { id: rows[0].id } }) : null;
}

async function rollCrate(tx: Tx, input: { guildId: string; userId: string; tableSlug: string; source: string; idempotencyKey: string; roll?: number }) {
  const existing = await tx.crateGrant.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    return { grant: existing, created: false };
  }
  const table = await tx.crateTable.findUnique({ where: { guildId_slug: { guildId: input.guildId, slug: input.tableSlug } } });
  if (!table || table.status !== "active") {
    throw new Halt("missing");
  }
  const entries = await tx.crateEntry.findMany({ where: { tableId: table.id }, orderBy: { slug: "asc" } });
  if (crateTableDecision(entries) !== "allowed") {
    throw new Halt("invalid");
  }
  const pity = await lockPity(tx, input.guildId, input.userId, table.slug);
  if (!pity) {
    throw new Halt("missing");
  }
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  const guarantee = entries.find((entry) => entry.guarantee) ?? entries.find((entry) => entry.slug === table.guaranteeSlug);
  if (!guarantee) {
    throw new Halt("invalid");
  }
  const forced = pityDue(pity.count, table.pityThreshold);
  const roll = input.roll ?? randomInt(1, total + 1);
  let cursor = 0;
  let selected = entries[entries.length - 1] ?? guarantee;
  if (!forced) {
    for (const entry of entries) {
      cursor += entry.weight;
      if (roll <= cursor) {
        selected = entry;
        break;
      }
    }
  } else {
    selected = guarantee;
  }
  let outcome: StoredOutcome = { kind: selected.kind, slug: selected.slug, amount: selected.amount, converted: false, tableVersion: table.version, name: selected.slug };
  if (selected.kind === "material") {
    if (!(await changeMaterial(tx, input.guildId, input.userId, selected.slug, selected.amount))) {
      throw new Halt("invalid");
    }
  } else if (selected.kind === "gear") {
    await mintTemplate(tx, input.guildId, input.userId, selected.slug, input.idempotencyKey);
  } else if (selected.kind === "cosmetic") {
    const cosmetic = await giveCosmetic(tx, input.guildId, input.userId, selected.slug, selected.duplicatePolicy, input.idempotencyKey);
    if (cosmetic.converted) {
      outcome = { kind: "material", slug: "scrap", amount: cosmetic.amount, converted: true, tableVersion: table.version, name: "Duplicate salvage" };
    }
  } else {
    throw new Halt("invalid");
  }
  const pityAfter = selected.guarantee ? 0 : pity.count + 1;
  await tx.cratePity.update({ where: { id: pity.id }, data: { count: pityAfter, versionSeen: table.version } });
  const grant = await tx.crateGrant.create({
    data: {
      id: randomUUID(),
      guildId: input.guildId,
      userId: input.userId,
      tableSlug: table.slug,
      tableVersion: table.version,
      source: input.source,
      outcome: json(outcome),
      pityBefore: pity.count,
      pityAfter,
      status: "sealed",
      idempotencyKey: input.idempotencyKey,
    },
  });
  return { grant, created: true };
}

async function presentOffer(db: Writer, offer: { id: string; guildId: string; slug: string; name: string; description: string; shop: string; currency: string; price: number; stock: number; limitPerMember: number; minLevel: number; requiredRoleId: string; classSlug: string; deliverable: string; deliverableSlug: string; startsAt: Date | null; endsAt: Date | null; version: number }, userId?: string) {
  const crate = offer.deliverable === "crate" ? await previewTable(db, offer.guildId, offer.deliverableSlug, userId) : null;
  return {
    offerId: offer.id,
    slug: offer.slug,
    name: offer.name,
    description: offer.description,
    shop: offer.shop,
    currency: offer.currency,
    price: offer.price,
    stock: offer.stock,
    limitPerMember: offer.limitPerMember,
    minLevel: offer.minLevel,
    requiredRoleId: offer.requiredRoleId,
    classSlug: offer.classSlug,
    deliverable: offer.deliverable,
    startsAt: offer.startsAt?.toISOString() ?? null,
    endsAt: offer.endsAt?.toISOString() ?? null,
    version: offer.version,
    crate,
  };
}

async function previewTable(db: Writer, guildId: string, slug: string, userId?: string) {
  const table = await db.crateTable.findUnique({ where: { guildId_slug: { guildId, slug } } });
  if (!table) {
    return null;
  }
  const entries = await db.crateEntry.findMany({ where: { tableId: table.id }, orderBy: { slug: "asc" } });
  const pity = userId ? await db.cratePity.findUnique({ where: { guildId_userId_tableSlug: { guildId, userId, tableSlug: slug } } }) : null;
  return {
    slug: table.slug,
    name: table.name,
    version: table.version,
    policy: table.policy,
    price: table.price,
    currency: table.currency,
    pity: pity?.count ?? 0,
    versionSeen: pity?.versionSeen ?? table.version,
    threshold: table.pityThreshold,
    guarantee: table.guaranteeSlug,
    odds: publishedOdds(entries),
  };
}

export async function browseShop(db: Writer, input: { guildId: string; shop: "supply" | "ingot"; userId?: string; now: Date }) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  await ensureShop(db, input.guildId);
  const rows = await db.shopOffer.findMany({ where: { guildId: input.guildId, shop: input.shop, status: "active" }, orderBy: { slug: "asc" } });
  const visible = [];
  for (const row of rows) {
    if (!offerOpen(input.now, row.startsAt, row.endsAt)) {
      continue;
    }
    visible.push(await presentOffer(db, row, input.userId));
  }
  return { result: "ready" as const, offers: visible, rules: SHOP_RULES };
}

export async function previewCrate(db: Writer, input: { guildId: string; userId: string; tableSlug: string }) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  await ensureShop(db, input.guildId);
  const preview = await previewTable(db, input.guildId, input.tableSlug, input.userId);
  if (!preview) {
    return { result: "missing" as const };
  }
  return { result: "preview" as const, ...preview };
}

export async function buyOffer(db: Root, input: { guildId: string; userId: string; offerSlug: string; idempotencyKey: string; roleIds?: readonly string[]; now: Date }) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if (!input.idempotencyKey.trim()) {
    return { result: "invalid" as const };
  }
  await ensureShop(db, input.guildId);
  const prior = await db.shopPurchase.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (prior) {
    return { result: "already_recorded" as const, purchaseId: prior.id, status: prior.status, deliverable: prior.deliverable, receipt: prior.receipt };
  }
  try {
    return await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "shop_offer" WHERE "guildId" = ${input.guildId} AND "slug" = ${input.offerSlug} FOR UPDATE`;
      const offer = locked[0] ? await tx.shopOffer.findUnique({ where: { id: locked[0].id } }) : null;
      if (!offer || offer.status !== "active") {
        throw new Halt("missing");
      }
      if (!offerOpen(input.now, offer.startsAt, offer.endsAt) || shopPriceDecision(offer.price) !== "allowed") {
        throw new Halt("closed");
      }
      if (offer.stock < 1) {
        throw new Halt("insufficient");
      }
      const character = await tx.playerCharacter.findUnique({ where: { guildId_userId: { guildId: input.guildId, userId: input.userId } } });
      if ((character?.level ?? 1) < offer.minLevel) {
        throw new Halt("level");
      }
      if (offer.classSlug && character?.classSlug !== offer.classSlug) {
        throw new Halt("denied");
      }
      if (offer.requiredRoleId && !(input.roleIds ?? []).includes(offer.requiredRoleId)) {
        throw new Halt("denied");
      }
      if (offer.limitPerMember > 0) {
        const used = await tx.shopPurchase.count({ where: { guildId: input.guildId, userId: input.userId, offerId: offer.id, status: { in: ["held", "delivered", "fulfilled", "revealed"] } } });
        if (used >= offer.limitPerMember) {
          throw new Halt("limit");
        }
      }
      const purchaseId = randomUUID();
      if (offer.currency === "marks") {
        const paid = await payMarks(tx, input.guildId, input.userId, offer.price, `${purchaseId}:marks`, false, input.now);
        if (paid !== "ok") {
          throw new Halt(paid === "insufficient" ? "insufficient" : "invalid");
        }
      } else if (offer.currency === "ingots") {
        const held = await applyShopIngotMove(tx, { guildId: input.guildId, userId: input.userId, quantity: offer.price, idempotencyKey: `${purchaseId}:hold`, now: input.now, kind: "hold" });
        if (held.result !== "ok") {
          throw new Halt(held.result === "insufficient" ? "insufficient" : "invalid");
        }
      } else {
        throw new Halt("invalid");
      }
      await tx.shopOffer.update({ where: { id: offer.id }, data: { stock: offer.stock - 1 } });
      let status = offer.deliverable === "steam_key" ? "held" : "fulfilled";
      if (offer.deliverable === "gear") {
        await mintTemplate(tx, input.guildId, input.userId, offer.deliverableSlug, `shop:${purchaseId}`);
      } else if (offer.deliverable === "material") {
        if (!(await changeMaterial(tx, input.guildId, input.userId, offer.deliverableSlug, offer.amount))) {
          throw new Halt("invalid");
        }
      } else if (offer.deliverable === "cosmetic") {
        const cosmetic = await giveCosmetic(tx, input.guildId, input.userId, offer.deliverableSlug, offer.duplicatePolicy, `shop:${purchaseId}`);
        if (cosmetic.converted) {
          status = "fulfilled";
        }
      } else if (offer.deliverable === "crate") {
        await rollCrate(tx, { guildId: input.guildId, userId: input.userId, tableSlug: offer.deliverableSlug, source: "shop", idempotencyKey: `crate:${purchaseId}` });
      } else if (offer.deliverable !== "service" && offer.deliverable !== "steam_key") {
        throw new Halt("invalid");
      }
      if (offer.currency === "ingots" && offer.deliverable !== "steam_key") {
        const committed = await applyShopIngotMove(tx, { guildId: input.guildId, userId: input.userId, quantity: offer.price, idempotencyKey: `${purchaseId}:commit`, now: input.now, kind: "commit" });
        if (committed.result !== "ok") {
          throw new Halt(committed.result === "insufficient" ? "insufficient" : "invalid");
        }
      }
      const text = receipt(offer.name, offer.price, offer.currency, status, purchaseId);
      const purchase = await tx.shopPurchase.create({
        data: { id: purchaseId, guildId: input.guildId, userId: input.userId, offerId: offer.id, offerSlug: offer.slug, offerVersion: offer.version, currency: offer.currency, amount: offer.price, status, deliverable: offer.deliverable, receipt: text, idempotencyKey: input.idempotencyKey },
      });
      return { result: "ready" as const, purchaseId: purchase.id, status: purchase.status, deliverable: purchase.deliverable, receipt: purchase.receipt };
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    if (isUnique(error)) {
      const again = await db.shopPurchase.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      return again
        ? { result: "already_recorded" as const, purchaseId: again.id, status: again.status, deliverable: again.deliverable, receipt: again.receipt }
        : { result: "closed" as const };
    }
    throw error;
  }
}

export async function deliverPurchase(db: Root, input: { guildId: string; userId: string; purchaseId: string; now: Date }) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  try {
    return await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "shop_purchase" WHERE "id" = ${input.purchaseId} FOR UPDATE`;
      const purchase = rows[0] ? await tx.shopPurchase.findUnique({ where: { id: rows[0].id } }) : null;
      if (!purchase || purchase.guildId !== input.guildId || purchase.userId !== input.userId) {
        return { result: "missing" as const };
      }
      if (purchase.status === "delivered" || purchase.status === "revealed" || purchase.status === "fulfilled") {
        return { result: "already_recorded" as const, purchaseId: purchase.id, status: purchase.status, dmStatus: "setup_required" as const, receipt: purchase.receipt };
      }
      if (purchase.status !== "held" || purchase.deliverable !== "steam_key") {
        return { result: "closed" as const };
      }
      const keys = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "steam_key"
        WHERE "guildId" = ${input.guildId} AND "offerSlug" = ${purchase.offerSlug} AND "status" = 'available'
        ORDER BY "id"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      const key = keys[0] ? await tx.steamKey.findUnique({ where: { id: keys[0].id } }) : null;
      if (!key) {
        return { result: "awaiting_stock" as const, purchaseId: purchase.id };
      }
      const committed = await applyShopIngotMove(tx, { guildId: input.guildId, userId: input.userId, quantity: purchase.amount, idempotencyKey: `${purchase.id}:commit`, now: input.now, kind: "commit" });
      if (committed.result !== "ok") {
        throw new Halt(committed.result === "insufficient" ? "insufficient" : "invalid");
      }
      await tx.steamKey.update({ where: { id: key.id }, data: { status: "assigned", purchaseId: purchase.id, userId: input.userId, assignedAt: input.now } });
      await tx.deliveryInbox.create({
        data: { id: randomUUID(), guildId: input.guildId, userId: input.userId, purchaseId: purchase.id, summary: PRIVATE_INBOX_DETAIL, dmStatus: "setup_required", status: "pending" },
      });
      const text = receipt(purchase.offerSlug, purchase.amount, purchase.currency, "delivered", purchase.id);
      await tx.shopPurchase.update({ where: { id: purchase.id }, data: { status: "delivered", receipt: text } });
      return { result: "delivered" as const, purchaseId: purchase.id, dmStatus: "setup_required" as const, receipt: text };
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    throw error;
  }
}

export async function revealPurchase(db: Root, input: { guildId: string; userId: string; purchaseId: string; now: Date }) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  const purchase = await db.shopPurchase.findUnique({ where: { id: input.purchaseId } });
  if (!purchase || purchase.guildId !== input.guildId || purchase.userId !== input.userId) {
    return { result: "missing" as const };
  }
  if (purchase.status !== "delivered" && purchase.status !== "revealed") {
    return { result: "closed" as const };
  }
  const key = await db.steamKey.findFirst({ where: { guildId: input.guildId, purchaseId: purchase.id, userId: input.userId } });
  if (!key) {
    return { result: "missing" as const };
  }
  const plain = openShopKey(key.ciphertext, key.nonce);
  if (!plain) {
    return { result: "setup_required" as const };
  }
  if (purchase.status !== "revealed") {
    await db.steamKey.update({ where: { id: key.id }, data: { status: "revealed", revealedAt: input.now } });
    await db.shopPurchase.update({ where: { id: purchase.id }, data: { status: "revealed" } });
    await db.deliveryInbox.updateMany({ where: { purchaseId: purchase.id }, data: { status: "revealed", revealedAt: input.now } });
  }
  return { result: "ready" as const, purchaseId: purchase.id, key: plain, dmStatus: "setup_required" as const };
}

export async function refundPurchase(db: Root, input: { guildId: string; userId: string; purchaseId: string; now: Date }) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  try {
    return await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "shop_purchase" WHERE "id" = ${input.purchaseId} FOR UPDATE`;
      const purchase = rows[0] ? await tx.shopPurchase.findUnique({ where: { id: rows[0].id } }) : null;
      if (!purchase || purchase.guildId !== input.guildId || purchase.userId !== input.userId) {
        return { result: "missing" as const };
      }
      if (purchase.status !== "held") {
        return { result: "review" as const, purchaseId: purchase.id };
      }
      if (purchase.currency === "ingots") {
        const refunded = await applyShopIngotMove(tx, { guildId: input.guildId, userId: input.userId, quantity: purchase.amount, idempotencyKey: `${purchase.id}:refund`, now: input.now, kind: "refund" });
        if (refunded.result !== "ok") {
          throw new Halt(refunded.result === "insufficient" ? "insufficient" : "invalid");
        }
      } else {
        const refunded = await payMarks(tx, input.guildId, input.userId, purchase.amount, `${purchase.id}:marks-refund`, true, input.now);
        if (refunded !== "ok") {
          throw new Halt(refunded === "insufficient" ? "insufficient" : "invalid");
        }
      }
      await tx.shopOffer.update({ where: { id: purchase.offerId }, data: { stock: { increment: 1 } } });
      await tx.shopPurchase.update({ where: { id: purchase.id }, data: { status: "refunded", receipt: receipt(purchase.offerSlug, purchase.amount, purchase.currency, "refunded", purchase.id) } });
      return { result: "refunded" as const, purchaseId: purchase.id };
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    throw error;
  }
}

export async function reviewRefund(db: Root, input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; purchaseId: string; now: Date }) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "economy_operations" })) !== "allowed") {
    return { result: "denied" as const };
  }
  try {
    return await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "shop_purchase" WHERE "id" = ${input.purchaseId} FOR UPDATE`;
      const purchase = rows[0] ? await tx.shopPurchase.findUnique({ where: { id: rows[0].id } }) : null;
      if (!purchase || purchase.guildId !== input.guildId) {
        return { result: "missing" as const };
      }
      if (purchase.status === "revealed") {
        await writeAudit(tx, { guildId: input.guildId, actorUserId: input.actorUserId, action: "shop.review", targetType: "shop_purchase", targetId: purchase.id, reason: "Steam key review. The secret stays revealed." });
        return { result: "recorded" as const, restored: false, purchaseId: purchase.id };
      }
      if (purchase.status !== "delivered" && purchase.status !== "held") {
        return { result: "closed" as const };
      }
      if (purchase.currency === "ingots" && purchase.status === "delivered") {
        const reversed = await applyShopIngotMove(tx, { guildId: input.guildId, userId: purchase.userId, quantity: purchase.amount, idempotencyKey: `${purchase.id}:reverse`, now: input.now, kind: "reverse" });
        if (reversed.result !== "ok") {
          throw new Halt(reversed.result === "insufficient" ? "insufficient" : "invalid");
        }
      }
      if (purchase.currency === "ingots" && purchase.status === "held") {
        const refunded = await applyShopIngotMove(tx, { guildId: input.guildId, userId: purchase.userId, quantity: purchase.amount, idempotencyKey: `${purchase.id}:refund`, now: input.now, kind: "refund" });
        if (refunded.result !== "ok") {
          throw new Halt(refunded.result === "insufficient" ? "insufficient" : "invalid");
        }
      }
      if (purchase.deliverable === "steam_key") {
        await tx.steamKey.updateMany({ where: { purchaseId: purchase.id }, data: { status: "available", purchaseId: "", userId: "", assignedAt: null, revealedAt: null } });
      }
      await tx.shopOffer.update({ where: { id: purchase.offerId }, data: { stock: { increment: 1 } } });
      await tx.deliveryInbox.updateMany({ where: { purchaseId: purchase.id }, data: { status: "cancelled" } });
      await tx.shopPurchase.update({ where: { id: purchase.id }, data: { status: "refunded" } });
      await writeAudit(tx, { guildId: input.guildId, actorUserId: input.actorUserId, action: "shop.review", targetType: "shop_purchase", targetId: purchase.id, reason: "Refund a shop purchase before reveal" });
      return { result: "refunded" as const, restored: true, purchaseId: purchase.id };
    });
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    throw error;
  }
}

export async function grantCrate(db: Root, input: { guildId: string; userId: string; tableSlug: string; source: string; idempotencyKey: string; roll?: number }) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  await ensureShop(db, input.guildId);
  try {
    const rolled = await db.$transaction((tx) => rollCrate(tx, input));
    const outcome = asOutcome(rolled.grant.outcome);
    return { result: rolled.created ? "ready" as const : "already_recorded" as const, grantId: rolled.grant.id, outcome, pity: rolled.grant.pityAfter, version: rolled.grant.tableVersion };
  } catch (error) {
    if (error instanceof Halt) {
      return { result: error.outcome };
    }
    throw error;
  }
}

export async function openCrate(db: Root, input: { guildId: string; userId: string; grantId: string }) {
  const grant = await db.crateGrant.findUnique({ where: { id: input.grantId } });
  if (!grant || grant.guildId !== input.guildId || grant.userId !== input.userId) {
    return { result: "missing" as const };
  }
  if (grant.status !== "revealed") {
    await db.crateGrant.update({ where: { id: grant.id }, data: { status: "revealed" } });
  }
  return { result: "ready" as const, grantId: grant.id, outcome: asOutcome(grant.outcome), version: grant.tableVersion };
}

export async function listCrates(db: Writer, input: { guildId: string; userId: string }) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  await ensureShop(db, input.guildId);
  const rows = await db.crateGrant.findMany({ where: { guildId: input.guildId, userId: input.userId }, orderBy: { createdAt: "asc" } });
  return { result: "ready" as const, grants: rows.map((row) => ({ grantId: row.id, tableSlug: row.tableSlug, version: row.tableVersion, status: row.status, outcome: asOutcome(row.outcome) })) };
}

export async function importSteamKey(db: Root, input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; offerSlug: string; keyMaterial: string; now: Date }) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "economy_operations" })) !== "allowed") {
    return { result: "denied" as const };
  }
  if (!shopKeySecretReady()) {
    return { result: "setup_required" as const };
  }
  const sealed = sealShopKey(input.keyMaterial);
  if (!sealed) {
    return { result: "invalid" as const };
  }
  await ensureShop(db, input.guildId);
  const offer = await db.shopOffer.findUnique({ where: { guildId_slug: { guildId: input.guildId, slug: input.offerSlug } } });
  if (!offer || offer.deliverable !== "steam_key") {
    return { result: "missing" as const };
  }
  const id = randomUUID();
  await db.steamKey.create({ data: { id, guildId: input.guildId, offerSlug: offer.slug, ciphertext: sealed.ciphertext, nonce: sealed.nonce, status: "available" } });
  await db.shopOffer.update({ where: { id: offer.id }, data: { stock: { increment: 1 } } });
  await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "shop.key", targetType: "steam_key", targetId: id, reason: "Import a Steam key" });
  return { result: "stocked" as const, id };
}

export async function assignVaultKey(tx: Tx, input: { guildId: string; userId: string; source: string; sourceId: string; now: Date }) {
  const offers = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "shop_offer" WHERE "guildId" = ${input.guildId} AND "slug" = 'steam-key' FOR UPDATE`;
  const offer = offers[0] ? await tx.shopOffer.findUnique({ where: { id: offers[0].id } }) : null;
  if (!offer || offer.stock < 1) {
    return { result: "none" as const };
  }
  const keys = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "steam_key"
    WHERE "guildId" = ${input.guildId} AND "offerSlug" = 'steam-key' AND "status" = 'available'
    ORDER BY "id"
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  `;
  const key = keys[0] ? await tx.steamKey.findUnique({ where: { id: keys[0].id } }) : null;
  if (!key) {
    return { result: "none" as const };
  }
  const purchaseId = `giveaway:${input.source}:${input.sourceId}:${input.userId}`;
  await tx.shopOffer.update({ where: { id: offer.id }, data: { stock: { decrement: 1 } } });
  await tx.steamKey.update({ where: { id: key.id }, data: { status: "assigned", purchaseId, userId: input.userId, assignedAt: input.now } });
  await tx.deliveryInbox.create({
    data: { id: randomUUID(), guildId: input.guildId, userId: input.userId, purchaseId, summary: PRIVATE_INBOX_DETAIL, dmStatus: "setup_required", status: "pending" },
  });
  return { result: "assigned" as const, detail: PRIVATE_INBOX_DETAIL };
}

export async function saveShopOffer(db: Root, input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; slug: string; name: string; shop: string; currency: string; price: number; stock: number; limitPerMember: number; minLevel: number; requiredRoleId: string; classSlug: string; deliverable: string; deliverableSlug: string; amount: number; duplicatePolicy: string; startsAt?: Date | null; endsAt?: Date | null }) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "economy_operations" })) !== "allowed") {
    return { result: "denied" as const };
  }
  if (!input.slug.trim() || !input.name.trim() || (input.shop !== "supply" && input.shop !== "ingot") || (input.currency !== "marks" && input.currency !== "ingots") || shopPriceDecision(input.price) !== "allowed" || !Number.isInteger(input.stock) || input.stock < 0) {
    return { result: "invalid" as const };
  }
  if (input.deliverable === "steam_key" && input.shop !== "ingot") {
    return { result: "invalid" as const };
  }
  await ensureShop(db, input.guildId);
  const current = await db.shopOffer.findUnique({ where: { guildId_slug: { guildId: input.guildId, slug: input.slug.trim() } } });
  if (current) {
    await db.shopOffer.update({
      where: { id: current.id },
      data: { name: input.name.trim(), shop: input.shop, currency: input.currency, price: input.price, stock: input.stock, limitPerMember: input.limitPerMember, minLevel: input.minLevel, requiredRoleId: input.requiredRoleId, classSlug: input.classSlug, deliverable: input.deliverable, deliverableSlug: input.deliverableSlug, amount: input.amount, duplicatePolicy: input.duplicatePolicy, startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null, version: current.version + 1, status: "active" },
    });
    await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "shop.offer", targetType: "shop_offer", targetId: current.id, reason: "Edit a shop offer" });
    return { result: "saved" as const, version: current.version + 1 };
  }
  const created = await db.shopOffer.create({
    data: { id: randomUUID(), guildId: input.guildId, slug: input.slug.trim(), name: input.name.trim(), description: input.name.trim(), shop: input.shop, currency: input.currency, price: input.price, stock: input.stock, limitPerMember: input.limitPerMember, minLevel: input.minLevel, requiredRoleId: input.requiredRoleId, classSlug: input.classSlug, deliverable: input.deliverable, deliverableSlug: input.deliverableSlug, amount: input.amount, duplicatePolicy: input.duplicatePolicy, startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null, status: "active", version: 1 },
  });
  await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "shop.offer", targetType: "shop_offer", targetId: created.id, reason: "Add a shop offer" });
  return { result: "saved" as const, version: 1 };
}

export async function saveCrateTable(db: Root, input: { guildId: string; actorUserId: string; actorRoleIds: readonly string[]; slug: string; name: string; currency: string; price: number; pityThreshold: number; guaranteeSlug: string; replacesSlug?: string; entries: Array<{ slug: string; kind: string; weight: number; amount: number; duplicatePolicy: string; guarantee: boolean }> }) {
  if (!(await openEconomy(db, input.guildId))) {
    return { result: "maintenance" as const };
  }
  if ((await actorCan(db, { guildId: input.guildId, roleIds: input.actorRoleIds, capability: "economy_operations" })) !== "allowed") {
    return { result: "denied" as const };
  }
  if (!input.slug.trim() || !input.name.trim() || shopPriceDecision(input.price) !== "allowed" || !Number.isInteger(input.pityThreshold) || input.pityThreshold < 1 || crateTableDecision(input.entries) !== "allowed" || !input.entries.some((entry) => entry.guarantee && entry.slug === input.guaranteeSlug)) {
    return { result: "invalid" as const };
  }
  await ensureShop(db, input.guildId);
  const current = await db.crateTable.findUnique({ where: { guildId_slug: { guildId: input.guildId, slug: input.slug.trim() } } });
  const version = current ? current.version + 1 : 1;
  const id = current?.id ?? randomUUID();
  if (current) {
    await db.crateEntry.deleteMany({ where: { tableId: current.id } });
    await db.crateTable.update({ where: { id: current.id }, data: { name: input.name.trim(), version, currency: input.currency, price: input.price, pityThreshold: input.pityThreshold, guaranteeSlug: input.guaranteeSlug, replacesSlug: input.replacesSlug ?? "", status: "active" } });
  } else {
    await db.crateTable.create({ data: { id, guildId: input.guildId, slug: input.slug.trim(), name: input.name.trim(), version, currency: input.currency, price: input.price, pityThreshold: input.pityThreshold, guaranteeSlug: input.guaranteeSlug, policy: CRATE_POLICY, status: "active", replacesSlug: input.replacesSlug ?? "" } });
  }
  await db.crateEntry.createMany({ data: input.entries.map((entry) => ({ id: randomUUID(), guildId: input.guildId, tableId: id, ...entry })) });
  if (input.replacesSlug) {
    const prior = await db.cratePity.findMany({ where: { guildId: input.guildId, tableSlug: input.replacesSlug } });
    for (const row of prior) {
      const destination = await db.cratePity.findUnique({ where: { guildId_userId_tableSlug: { guildId: input.guildId, userId: row.userId, tableSlug: input.slug.trim() } } });
      if (!destination) {
        await db.cratePity.create({ data: { id: randomUUID(), guildId: input.guildId, userId: row.userId, tableSlug: input.slug.trim(), count: row.count, versionSeen: version } });
      }
    }
  }
  await writeAudit(db, { guildId: input.guildId, actorUserId: input.actorUserId, action: "shop.crate", targetType: "crate_table", targetId: id, reason: "Publish a crate table" });
  return { result: "saved" as const, version };
}

export async function readShopStaff(db: Writer, guildId: string) {
  if (!(await openEconomy(db, guildId))) {
    return { result: "maintenance" as const };
  }
  await ensureShop(db, guildId);
  const offers = await db.shopOffer.findMany({ where: { guildId }, orderBy: { slug: "asc" } });
  const tables = await db.crateTable.findMany({ where: { guildId }, orderBy: { slug: "asc" } });
  const crates = [];
  for (const table of tables) {
    const entries = await db.crateEntry.findMany({ where: { tableId: table.id }, orderBy: { slug: "asc" } });
    crates.push({ slug: table.slug, name: table.name, version: table.version, policy: table.policy, pityThreshold: table.pityThreshold, guaranteeSlug: table.guaranteeSlug, odds: publishedOdds(entries) });
  }
  const grouped = await db.steamKey.groupBy({ by: ["status"], where: { guildId }, _count: { _all: true } });
  const purchases = await db.shopPurchase.findMany({ where: { guildId }, orderBy: { createdAt: "desc" }, take: 20 });
  return {
    result: "ready" as const,
    rules: SHOP_RULES,
    offers: offers.map((offer) => ({ slug: offer.slug, name: offer.name, shop: offer.shop, currency: offer.currency, price: offer.price, stock: offer.stock, limitPerMember: offer.limitPerMember, minLevel: offer.minLevel, version: offer.version })),
    crates,
    keys: Object.fromEntries(grouped.map((row) => [row.status, row._count._all])),
    purchases: purchases.map((row) => ({ id: row.id, userId: row.userId, offerSlug: row.offerSlug, amount: row.amount, currency: row.currency, status: row.status })),
  };
}
