CREATE TABLE "pvp_rating" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 1000,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "lifetimeWins" INTEGER NOT NULL DEFAULT 0,
    "lifetimeLosses" INTEGER NOT NULL DEFAULT 0,
    "lifetimeDraws" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "pvp_rating_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pvp_rating_guildId_userId_seasonId_key" ON "pvp_rating"("guildId", "userId", "seasonId");
CREATE INDEX "pvp_rating_guildId_seasonId_rating_idx" ON "pvp_rating"("guildId", "seasonId", "rating");

CREATE TABLE "pvp_queue_entry" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "stake" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "joinedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "pvp_queue_entry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "pvp_queue_entry_guildId_status_mode_stake_idx" ON "pvp_queue_entry"("guildId", "status", "mode", "stake");

CREATE TABLE "pvp_match" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "requestedMode" TEXT NOT NULL,
    "demoted" BOOLEAN NOT NULL DEFAULT false,
    "stake" INTEGER NOT NULL DEFAULT 0,
    "style" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "leftUserId" TEXT NOT NULL,
    "rightUserId" TEXT NOT NULL,
    "pairKey" TEXT NOT NULL,
    "acceptedLeft" BOOLEAN NOT NULL DEFAULT false,
    "acceptedRight" BOOLEAN NOT NULL DEFAULT false,
    "battleId" TEXT NOT NULL DEFAULT '',
    "winnerUserId" TEXT NOT NULL DEFAULT '',
    "outcome" TEXT NOT NULL DEFAULT '',
    "rankedEligible" BOOLEAN NOT NULL DEFAULT false,
    "dayKey" TEXT NOT NULL DEFAULT '',
    "rules" TEXT NOT NULL,
    "leftMisses" INTEGER NOT NULL DEFAULT 0,
    "rightMisses" INTEGER NOT NULL DEFAULT 0,
    "turnUserId" TEXT NOT NULL DEFAULT '',
    "turnDeadline" TIMESTAMPTZ(6),
    "leftDisconnectedAt" TIMESTAMPTZ(6),
    "rightDisconnectedAt" TIMESTAMPTZ(6),
    "ratingPosted" BOOLEAN NOT NULL DEFAULT false,
    "rewardsPosted" BOOLEAN NOT NULL DEFAULT false,
    "wagerPosted" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMPTZ(6),
    CONSTRAINT "pvp_match_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pvp_match_idempotencyKey_key" ON "pvp_match"("idempotencyKey");
CREATE INDEX "pvp_match_guildId_pairKey_dayKey_idx" ON "pvp_match"("guildId", "pairKey", "dayKey");
CREATE INDEX "pvp_match_guildId_status_idx" ON "pvp_match"("guildId", "status");

CREATE TABLE "pvp_review" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "pairKey" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pvp_review_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pvp_review_matchId_key" ON "pvp_review"("matchId");
CREATE INDEX "pvp_review_guildId_status_idx" ON "pvp_review"("guildId", "status");

UPDATE "foundation_revision"
SET "revision" = '0s',
    "summary" = 'Phase 8A casual and ranked queues, challenges, ratings, and wagers.'
WHERE "id" = 'collective';
