ALTER TABLE "gear_instance" ADD COLUMN "upgradeTier" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "gear_instance" ADD COLUMN "rerollCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "gear_instance" ADD COLUMN "upgradeHistory" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE "workshop_settings" (
    "guildId" TEXT NOT NULL,
    "upgradeCap" INTEGER NOT NULL DEFAULT 3,
    "listingLimit" INTEGER NOT NULL DEFAULT 3,
    "listingHours" INTEGER NOT NULL DEFAULT 72,
    "listingFeeMarks" INTEGER NOT NULL DEFAULT 0,
    "rerollBaseMarks" INTEGER NOT NULL DEFAULT 10,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "workshop_settings_pkey" PRIMARY KEY ("guildId")
);

CREATE TABLE "material_stock" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "material_stock_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "material_stock_guildId_userId_slug_key" ON "material_stock"("guildId", "userId", "slug");

CREATE TABLE "craft_recipe" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "outputSlug" TEXT NOT NULL,
    "outputAffixes" JSONB NOT NULL,
    "inputSlug" TEXT NOT NULL,
    "inputAmount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "craft_recipe_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "craft_recipe_guildId_slug_key" ON "craft_recipe"("guildId", "slug");

CREATE TABLE "trade_offer" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "offerItemId" TEXT NOT NULL DEFAULT '',
    "requestItemId" TEXT NOT NULL DEFAULT '',
    "offerMarks" INTEGER NOT NULL DEFAULT 0,
    "requestMarks" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "fromConfirmedVersion" INTEGER NOT NULL DEFAULT 0,
    "toConfirmedVersion" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "settledAt" TIMESTAMPTZ(6),
    "idempotencyKey" TEXT NOT NULL,
    CONSTRAINT "trade_offer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "trade_offer_idempotencyKey_key" ON "trade_offer"("idempotencyKey");
CREATE INDEX "trade_offer_guildId_status_expiresAt_idx" ON "trade_offer"("guildId", "status", "expiresAt");

CREATE TABLE "market_listing" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL DEFAULT '',
    "itemId" TEXT NOT NULL,
    "priceMarks" INTEGER NOT NULL,
    "feeMarks" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "listingKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "settledAt" TIMESTAMPTZ(6),
    "idempotencyKey" TEXT NOT NULL,
    CONSTRAINT "market_listing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "market_listing_listingKey_key" ON "market_listing"("listingKey");
CREATE UNIQUE INDEX "market_listing_idempotencyKey_key" ON "market_listing"("idempotencyKey");
CREATE INDEX "market_listing_guildId_status_expiresAt_idx" ON "market_listing"("guildId", "status", "expiresAt");

UPDATE "foundation_revision"
SET "revision" = '0t',
    "summary" = 'Phase 8B trades, marketplace escrow, upgrades, salvage, crafting, and rerolls.'
WHERE "id" = 'collective';
