CREATE TABLE "blackjack_settings" (
    "guildId" TEXT NOT NULL,
    "minBetMarks" INTEGER NOT NULL,
    "maxBetMarks" INTEGER NOT NULL,
    "tableCap" INTEGER NOT NULL,
    "joinSeconds" INTEGER NOT NULL,
    "turnSeconds" INTEGER NOT NULL,
    "decks" INTEGER NOT NULL,
    "hitSoft17" BOOLEAN NOT NULL,
    "naturalNum" INTEGER NOT NULL,
    "naturalDen" INTEGER NOT NULL,
    "regularNum" INTEGER NOT NULL,
    "regularDen" INTEGER NOT NULL,
    "maxSplits" INTEGER NOT NULL,
    "splitAcesOneCard" BOOLEAN NOT NULL,
    "splitBlackjackPaysRegular" BOOLEAN NOT NULL,
    "version" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "blackjack_settings_pkey" PRIMARY KEY ("guildId")
);

CREATE TABLE "blackjack_table" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rulesVersion" INTEGER NOT NULL,
    "rules" JSONB NOT NULL,
    "shoe" JSONB NOT NULL,
    "cursor" INTEGER NOT NULL,
    "dealer" JSONB NOT NULL,
    "joinUntil" TIMESTAMPTZ(6) NOT NULL,
    "turnHandId" TEXT NOT NULL,
    "turnDeadline" TIMESTAMPTZ(6),
    "settledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "blackjack_table_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "blackjack_table_guildId_status_idx" ON "blackjack_table"("guildId", "status");

CREATE TABLE "blackjack_seat" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seat" INTEGER NOT NULL,
    "stakeMinor" BIGINT NOT NULL,
    "exposureMinor" BIGINT NOT NULL,
    "profitMinor" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    CONSTRAINT "blackjack_seat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "blackjack_seat_tableId_userId_key" ON "blackjack_seat"("tableId", "userId");
CREATE UNIQUE INDEX "blackjack_seat_tableId_seat_key" ON "blackjack_seat"("tableId", "seat");
CREATE INDEX "blackjack_seat_guildId_idx" ON "blackjack_seat"("guildId");

CREATE TABLE "blackjack_hand" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "seatId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "cards" JSONB NOT NULL,
    "stakeMinor" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "doubled" BOOLEAN NOT NULL,
    "fromSplit" BOOLEAN NOT NULL,
    "splitAce" BOOLEAN NOT NULL,
    "stoodReason" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "profitMinor" BIGINT NOT NULL,
    CONSTRAINT "blackjack_hand_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "blackjack_hand_seatId_position_key" ON "blackjack_hand"("seatId", "position");
CREATE INDEX "blackjack_hand_tableId_idx" ON "blackjack_hand"("tableId");

CREATE TABLE "blackjack_action" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "handId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "card" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "blackjack_action_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "blackjack_action_idempotencyKey_key" ON "blackjack_action"("idempotencyKey");
CREATE INDEX "blackjack_action_tableId_idx" ON "blackjack_action"("tableId");

CREATE TABLE "blackjack_quote" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "stakeMinor" BIGINT NOT NULL,
    "exposureMinor" BIGINT NOT NULL,
    "naturalProfitMinor" BIGINT NOT NULL,
    "regularProfitMinor" BIGINT NOT NULL,
    "rulesVersion" INTEGER NOT NULL,
    "rules" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "blackjack_quote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "blackjack_quote_idempotencyKey_key" ON "blackjack_quote"("idempotencyKey");
CREATE INDEX "blackjack_quote_guildId_userId_idx" ON "blackjack_quote"("guildId", "userId");

CREATE TABLE "blackjack_receipt" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "stakeMinor" BIGINT NOT NULL,
    "exposureMinor" BIGINT NOT NULL,
    "profitMinor" BIGINT NOT NULL,
    "rulesVersion" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "blackjack_receipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "blackjack_receipt_idempotencyKey_key" ON "blackjack_receipt"("idempotencyKey");
CREATE INDEX "blackjack_receipt_tableId_userId_idx" ON "blackjack_receipt"("tableId", "userId");

CREATE TABLE "blackjack_notice" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "blackjack_notice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "blackjack_notice_tableId_userId_kind_key" ON "blackjack_notice"("tableId", "userId", "kind");

UPDATE "foundation_revision"
SET "revision" = '0x',
    "summary" = 'Phase 9C solo and social blackjack with a funded house bankroll.'
WHERE "id" = 'collective';
