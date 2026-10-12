CREATE TABLE "shop_offer" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL,
    "limitPerMember" INTEGER NOT NULL DEFAULT 0,
    "minLevel" INTEGER NOT NULL DEFAULT 1,
    "requiredRoleId" TEXT NOT NULL DEFAULT '',
    "classSlug" TEXT NOT NULL DEFAULT '',
    "deliverable" TEXT NOT NULL,
    "deliverableSlug" TEXT NOT NULL DEFAULT '',
    "amount" INTEGER NOT NULL DEFAULT 1,
    "duplicatePolicy" TEXT NOT NULL DEFAULT 'keep',
    "startsAt" TIMESTAMPTZ(6),
    "endsAt" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "shop_offer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "shop_offer_guildId_slug_key" ON "shop_offer"("guildId", "slug");
CREATE INDEX "shop_offer_guildId_shop_status_idx" ON "shop_offer"("guildId", "shop", "status");

CREATE TABLE "shop_purchase" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "offerSlug" TEXT NOT NULL,
    "offerVersion" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "deliverable" TEXT NOT NULL,
    "receipt" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shop_purchase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "shop_purchase_idempotencyKey_key" ON "shop_purchase"("idempotencyKey");
CREATE INDEX "shop_purchase_guildId_userId_offerId_idx" ON "shop_purchase"("guildId", "userId", "offerId");

CREATE TABLE "steam_key" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "offerSlug" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL DEFAULT '',
    "assignedAt" TIMESTAMPTZ(6),
    "revealedAt" TIMESTAMPTZ(6),
    CONSTRAINT "steam_key_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "steam_key_guildId_offerSlug_status_idx" ON "steam_key"("guildId", "offerSlug", "status");

CREATE TABLE "delivery_inbox" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "dmStatus" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "revealedAt" TIMESTAMPTZ(6),
    CONSTRAINT "delivery_inbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "delivery_inbox_purchaseId_key" ON "delivery_inbox"("purchaseId");
CREATE INDEX "delivery_inbox_guildId_userId_idx" ON "delivery_inbox"("guildId", "userId");

CREATE TABLE "crate_table" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "pityThreshold" INTEGER NOT NULL,
    "guaranteeSlug" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "replacesSlug" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "crate_table_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crate_table_guildId_slug_key" ON "crate_table"("guildId", "slug");

CREATE TABLE "crate_entry" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 1,
    "duplicatePolicy" TEXT NOT NULL DEFAULT 'keep',
    "guarantee" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "crate_entry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "crate_entry_tableId_idx" ON "crate_entry"("tableId");

CREATE TABLE "crate_pity" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tableSlug" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "versionSeen" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "crate_pity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crate_pity_guildId_userId_tableSlug_key" ON "crate_pity"("guildId", "userId", "tableSlug");

CREATE TABLE "crate_grant" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tableSlug" TEXT NOT NULL,
    "tableVersion" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "outcome" JSONB NOT NULL,
    "pityBefore" INTEGER NOT NULL,
    "pityAfter" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crate_grant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crate_grant_idempotencyKey_key" ON "crate_grant"("idempotencyKey");
CREATE INDEX "crate_grant_guildId_userId_tableSlug_idx" ON "crate_grant"("guildId", "userId", "tableSlug");

CREATE TABLE "cosmetic_item" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "binding" TEXT NOT NULL,
    "destroyed" BOOLEAN NOT NULL DEFAULT false,
    "provenance" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cosmetic_item_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cosmetic_item_idempotencyKey_key" ON "cosmetic_item"("idempotencyKey");
CREATE INDEX "cosmetic_item_guildId_userId_slug_idx" ON "cosmetic_item"("guildId", "userId", "slug");

UPDATE "foundation_revision"
SET "revision" = '0u',
    "summary" = 'Phase 8C supply shop, Ingot shop, private Steam keys, and versioned crates.'
WHERE "id" = 'collective';
