CREATE TABLE "dead_drop_settings" (
    "guildId" TEXT NOT NULL,
    "pickMarks" INTEGER NOT NULL,
    "seedMarks" INTEGER NOT NULL,
    "smallMarks" INTEGER NOT NULL,
    "smallCount" INTEGER NOT NULL,
    "shareBps" INTEGER NOT NULL,
    "openMinutes" INTEGER NOT NULL,
    "hour" INTEGER,
    "minute" INTEGER,
    "specialKind" TEXT NOT NULL DEFAULT '',
    "specialPayload" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "dead_drop_settings_pkey" PRIMARY KEY ("guildId")
);

CREATE TABLE "dead_drop_budget" (
    "guildId" TEXT NOT NULL,
    "seedAuthorizedMinor" BIGINT NOT NULL,
    "seedReservedMinor" BIGINT NOT NULL DEFAULT 0,
    "seedSpentMinor" BIGINT NOT NULL DEFAULT 0,
    "smallAuthorizedMinor" BIGINT NOT NULL,
    "smallReservedMinor" BIGINT NOT NULL DEFAULT 0,
    "smallSpentMinor" BIGINT NOT NULL DEFAULT 0,
    "treasuryMinor" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "dead_drop_budget_pkey" PRIMARY KEY ("guildId")
);

CREATE TABLE "dead_drop_board" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "openKey" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "opensAt" TIMESTAMPTZ(6) NOT NULL,
    "closesAt" TIMESTAMPTZ(6) NOT NULL,
    "seedMinor" BIGINT NOT NULL,
    "carriedSeedMinor" BIGINT NOT NULL DEFAULT 0,
    "carriedPoolMinor" BIGINT NOT NULL DEFAULT 0,
    "carriedTreasuryMinor" BIGINT NOT NULL DEFAULT 0,
    "shareMinor" BIGINT NOT NULL DEFAULT 0,
    "treasuryMinor" BIGINT NOT NULL DEFAULT 0,
    "jackpotMinor" BIGINT NOT NULL,
    "commitment" TEXT NOT NULL,
    "specialKind" TEXT NOT NULL DEFAULT '',
    "previousBoardId" TEXT NOT NULL DEFAULT '',
    "winnerUserId" TEXT NOT NULL DEFAULT '',
    "winnerCoordinate" TEXT NOT NULL DEFAULT '',
    "settledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dead_drop_board_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dead_drop_board_openKey_key" ON "dead_drop_board"("openKey");
CREATE INDEX "dead_drop_board_guildId_status_idx" ON "dead_drop_board"("guildId", "status");
CREATE INDEX "dead_drop_board_chainId_idx" ON "dead_drop_board"("chainId");

CREATE TABLE "dead_drop_cell" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "coordinate" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT '',
    "revealedAt" TIMESTAMPTZ(6),
    CONSTRAINT "dead_drop_cell_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dead_drop_cell_boardId_coordinate_key" ON "dead_drop_cell"("boardId", "coordinate");
CREATE INDEX "dead_drop_cell_boardId_status_idx" ON "dead_drop_cell"("boardId", "status");

CREATE TABLE "dead_drop_pick" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "coordinate" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "priceMinor" BIGINT NOT NULL,
    "shareMinor" BIGINT NOT NULL,
    "treasuryMinor" BIGINT NOT NULL,
    "rewardKind" TEXT NOT NULL,
    "rewardDetail" TEXT NOT NULL DEFAULT '',
    "rewardRef" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dead_drop_pick_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dead_drop_pick_quoteId_key" ON "dead_drop_pick"("quoteId");
CREATE UNIQUE INDEX "dead_drop_pick_idempotencyKey_key" ON "dead_drop_pick"("idempotencyKey");
CREATE INDEX "dead_drop_pick_boardId_userId_idx" ON "dead_drop_pick"("boardId", "userId");
CREATE INDEX "dead_drop_pick_guildId_status_idx" ON "dead_drop_pick"("guildId", "status");

CREATE TABLE "dead_drop_quote" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "coordinate" TEXT NOT NULL,
    "settingsVersion" INTEGER NOT NULL,
    "priceMinor" BIGINT NOT NULL,
    "shareMinor" BIGINT NOT NULL,
    "jackpotMinor" BIGINT NOT NULL,
    "picksUsed" INTEGER NOT NULL,
    "opensAt" TIMESTAMPTZ(6) NOT NULL,
    "closesAt" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dead_drop_quote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dead_drop_quote_idempotencyKey_key" ON "dead_drop_quote"("idempotencyKey");
CREATE INDEX "dead_drop_quote_boardId_userId_idx" ON "dead_drop_quote"("boardId", "userId");

CREATE TABLE "dead_drop_reminder" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "dead_drop_reminder_pkey" PRIMARY KEY ("guildId", "userId")
);

CREATE TABLE "dead_drop_notice" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dead_drop_notice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dead_drop_notice_boardId_userId_kind_key" ON "dead_drop_notice"("boardId", "userId", "kind");

CREATE TABLE "dead_drop_post" (
    "boardId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "coalesceUntil" TIMESTAMPTZ(6),
    CONSTRAINT "dead_drop_post_pkey" PRIMARY KEY ("boardId")
);

UPDATE "foundation_revision"
SET "revision" = '0w',
    "summary" = 'Phase 9B Dead Drop board, rollover, and funded Market Collapse.'
WHERE "id" = 'collective';
