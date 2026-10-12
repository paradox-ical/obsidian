CREATE TABLE "lottery_settings" (
    "guildId" TEXT NOT NULL,
    "ticketMarks" INTEGER NOT NULL,
    "cap" INTEGER NOT NULL,
    "stallDays" INTEGER NOT NULL,
    "hour" INTEGER,
    "minute" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "lottery_settings_pkey" PRIMARY KEY ("guildId")
);

CREATE TABLE "lottery_budget" (
    "guildId" TEXT NOT NULL,
    "authorizedMinor" BIGINT NOT NULL,
    "reservedMinor" BIGINT NOT NULL DEFAULT 0,
    "spentMinor" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "lottery_budget_pkey" PRIMARY KEY ("guildId")
);

CREATE TABLE "lottery_draw" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "openKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "openedAt" TIMESTAMPTZ(6) NOT NULL,
    "closesAt" TIMESTAMPTZ(6),
    "stallAt" TIMESTAMPTZ(6) NOT NULL,
    "potMinor" BIGINT NOT NULL DEFAULT 0,
    "bonusMinor" BIGINT NOT NULL DEFAULT 0,
    "ticketCount" INTEGER NOT NULL DEFAULT 0,
    "rolloverCount" INTEGER NOT NULL DEFAULT 0,
    "snapshot" JSONB,
    "winnerTicketId" TEXT NOT NULL DEFAULT '',
    "winnerUserId" TEXT NOT NULL DEFAULT '',
    "winnerIndex" INTEGER NOT NULL DEFAULT -1,
    "settledAt" TIMESTAMPTZ(6),
    CONSTRAINT "lottery_draw_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "lottery_draw_openKey_key" ON "lottery_draw"("openKey");
CREATE INDEX "lottery_draw_guildId_status_idx" ON "lottery_draw"("guildId", "status");

CREATE TABLE "lottery_ticket" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "drawId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "priceMinor" BIGINT NOT NULL,
    "bonusMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lottery_ticket_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "lottery_ticket_drawId_userId_idx" ON "lottery_ticket"("drawId", "userId");

CREATE TABLE "lottery_purchase" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "drawId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "priceMinor" BIGINT NOT NULL,
    "bonusMinor" BIGINT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lottery_purchase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "lottery_purchase_idempotencyKey_key" ON "lottery_purchase"("idempotencyKey");
CREATE INDEX "lottery_purchase_drawId_idx" ON "lottery_purchase"("drawId");

CREATE TABLE "lottery_quote" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "drawId" TEXT NOT NULL,
    "settingsVersion" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "priceMinor" BIGINT NOT NULL,
    "bonusMinor" BIGINT NOT NULL,
    "deadline" TIMESTAMPTZ(6),
    "stallAt" TIMESTAMPTZ(6) NOT NULL,
    "oddsBasisPoints" INTEGER NOT NULL,
    "budgetRemainingMinor" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lottery_quote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "lottery_quote_idempotencyKey_key" ON "lottery_quote"("idempotencyKey");
CREATE INDEX "lottery_quote_drawId_userId_idx" ON "lottery_quote"("drawId", "userId");

UPDATE "foundation_revision"
SET "revision" = '0v',
    "summary" = 'Phase 9A funded daily lottery with reserved bonus, rollover, and stall refunds.'
WHERE "id" = 'collective';
