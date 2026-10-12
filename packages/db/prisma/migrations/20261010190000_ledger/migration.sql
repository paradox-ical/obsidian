-- CreateTable
CREATE TABLE "economy_settings" (
    "guildId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "economy_settings_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "wallet" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "availableMinor" BIGINT NOT NULL DEFAULT 0,
    "escrowMinor" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wallet_pkey" PRIMARY KEY ("guildId","userId","currency")
);

-- CreateTable
CREATE TABLE "ledger_entry" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "pace" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reversesEntryId" TEXT,
    "reason" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issuance_budget" (
    "guildId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "authorizedMinor" BIGINT NOT NULL,
    "spentMinor" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "issuance_budget_pkey" PRIMARY KEY ("guildId","scope","periodKey","subjectId")
);

-- CreateIndex
CREATE INDEX "wallet_guildId_currency_idx" ON "wallet"("guildId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entry_idempotencyKey_key" ON "ledger_entry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ledger_entry_guildId_userId_createdAt_idx" ON "ledger_entry"("guildId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_entry_guildId_kind_idx" ON "ledger_entry"("guildId", "kind");

UPDATE "foundation_revision"
SET "revision" = '0h',
    "summary" = 'Phase 3A Marks ledger, budgets, transfers, and staff statistics.'
WHERE "id" = 'collective';
