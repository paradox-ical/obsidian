-- CreateTable
CREATE TABLE "ingot_market" (
    "guildId" TEXT NOT NULL,
    "protectedReserve" BIGINT NOT NULL,
    "inventory" BIGINT NOT NULL,
    "eventTreasury" BIGINT NOT NULL,
    "chargeReserve" BIGINT NOT NULL,
    "backingMinor" BIGINT NOT NULL,
    "revision" INTEGER NOT NULL,
    "curveVersion" INTEGER NOT NULL,
    "baselineMarks" BIGINT NOT NULL,
    "activeSupply" BIGINT NOT NULL,
    "spreadBps" INTEGER NOT NULL,
    "quoteSeconds" INTEGER NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "panelChannelId" TEXT,
    "panelCoalesceUntil" TIMESTAMPTZ(6),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ingot_market_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "market_quote" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "quantity" BIGINT NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "revision" INTEGER NOT NULL,
    "curveVersion" INTEGER NOT NULL,
    "inventoryAtQuote" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_trade" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "quantity" BIGINT NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "inventoryAfter" BIGINT NOT NULL,
    "revisionAfter" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collapse_charge" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "holderUserId" TEXT NOT NULL,
    "quantity" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "announcement" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMPTZ(6),

    CONSTRAINT "collapse_charge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "market_quote_guildId_userId_status_idx" ON "market_quote"("guildId", "userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "market_quote_idempotencyKey_key" ON "market_quote"("idempotencyKey");

-- CreateIndex
CREATE INDEX "market_trade_guildId_createdAt_idx" ON "market_trade"("guildId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "collapse_charge_idempotencyKey_key" ON "collapse_charge"("idempotencyKey");

-- CreateIndex
CREATE INDEX "collapse_charge_guildId_status_idx" ON "collapse_charge"("guildId", "status");

UPDATE "foundation_revision"
SET "revision" = '0i',
    "summary" = 'Phase 3B Ingot supply, scarcity curve, quotes, and backing.'
WHERE "id" = 'collective';
