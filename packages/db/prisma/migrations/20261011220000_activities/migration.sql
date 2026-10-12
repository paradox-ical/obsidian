-- Phase 5B predictions, contests, and giveaways.

CREATE TABLE "prediction" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "rules" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "requiredRoleId" TEXT NOT NULL DEFAULT '',
    "minAccountDays" INTEGER NOT NULL DEFAULT 0,
    "attendanceOccurrenceId" TEXT NOT NULL DEFAULT '',
    "lockAt" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "prizeMarks" INTEGER NOT NULL,
    "houseFeeBps" INTEGER NOT NULL DEFAULT 0,
    "winningOutcomeId" TEXT NOT NULL DEFAULT '',
    "resolutionEvidence" TEXT NOT NULL DEFAULT '',
    "resolutionRule" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "prediction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "prediction_guildId_status_lockAt_idx" ON "prediction"("guildId", "status", "lockAt");

CREATE TABLE "prediction_outcome" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "predictionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prediction_outcome_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prediction_outcome_predictionId_position_key" ON "prediction_outcome"("predictionId", "position");

CREATE TABLE "prediction_entry" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "predictionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "stakeMarks" INTEGER NOT NULL,
    "pointsAwarded" INTEGER NOT NULL DEFAULT 0,
    "payoutMarks" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "prediction_entry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prediction_entry_predictionId_userId_key" ON "prediction_entry"("predictionId", "userId");

CREATE TABLE "prediction_score" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "prediction_score_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prediction_score_guildId_userId_key" ON "prediction_score"("guildId", "userId");

CREATE TABLE "contest" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "rules" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "allowedTypes" TEXT NOT NULL,
    "mediaLimit" INTEGER NOT NULL,
    "closesAt" TIMESTAMPTZ(6) NOT NULL,
    "editsBeforeClose" BOOLEAN NOT NULL,
    "selfVote" BOOLEAN NOT NULL,
    "blind" BOOLEAN NOT NULL,
    "privateEntries" BOOLEAN NOT NULL,
    "tiePolicy" TEXT NOT NULL,
    "requiredRoleId" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "publishedAt" TIMESTAMPTZ(6),
    "archivedAt" TIMESTAMPTZ(6),
    "stockId" TEXT NOT NULL DEFAULT '',
    "prizeQuantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "contest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "contest_guildId_status_idx" ON "contest"("guildId", "status");

CREATE TABLE "contest_criterion" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    CONSTRAINT "contest_criterion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contest_criterion_contestId_name_key" ON "contest_criterion"("contestId", "name");

CREATE TABLE "contest_entry" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "contest_entry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contest_entry_contestId_userId_key" ON "contest_entry"("contestId", "userId");

CREATE TABLE "contest_ballot" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "voterUserId" TEXT NOT NULL,
    "scores" JSONB NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "contest_ballot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contest_ballot_contestId_voterUserId_entryId_key" ON "contest_ballot"("contestId", "voterUserId", "entryId");
CREATE INDEX "contest_ballot_contestId_voterUserId_idx" ON "contest_ballot"("contestId", "voterUserId");

CREATE TABLE "contest_result" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "tied" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contest_result_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contest_result_contestId_entryId_key" ON "contest_result"("contestId", "entryId");

CREATE TABLE "prize_stock" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "onHand" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "marksEach" INTEGER NOT NULL DEFAULT 0,
    "shopStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "prize_stock_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "prize_stock_guildId_kind_idx" ON "prize_stock"("guildId", "kind");

CREATE TABLE "prize_fulfilment" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prize_fulfilment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prize_fulfilment_source_sourceId_userId_key" ON "prize_fulfilment"("source", "sourceId", "userId");

CREATE TABLE "giveaway" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rules" TEXT NOT NULL,
    "bonusRules" TEXT NOT NULL,
    "requiredRoleId" TEXT NOT NULL DEFAULT '',
    "minAccountDays" INTEGER NOT NULL DEFAULT 0,
    "attendanceOccurrenceId" TEXT NOT NULL DEFAULT '',
    "closesAt" TIMESTAMPTZ(6) NOT NULL,
    "claimMinutes" INTEGER NOT NULL,
    "maxBonus" INTEGER NOT NULL,
    "winnerCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "stockId" TEXT NOT NULL DEFAULT '',
    "prizeQuantity" INTEGER NOT NULL DEFAULT 1,
    "snapshot" JSONB,
    "closedAt" TIMESTAMPTZ(6),
    "sponsor" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "giveaway_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "giveaway_guildId_status_idx" ON "giveaway"("guildId", "status");

CREATE TABLE "giveaway_entry" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "giveawayId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "activityKey" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "giveaway_entry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "giveaway_entry_giveawayId_userId_kind_activityKey_key" ON "giveaway_entry"("giveawayId", "userId", "kind", "activityKey");
CREATE INDEX "giveaway_entry_giveawayId_userId_idx" ON "giveaway_entry"("giveawayId", "userId");
CREATE UNIQUE INDEX "giveaway_entry_activity_once" ON "giveaway_entry"("giveawayId", "activityKey") WHERE "kind" = 'bonus';

CREATE TABLE "giveaway_draw" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "giveawayId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "claimBy" TIMESTAMPTZ(6) NOT NULL,
    "fulfilment" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "actorUserId" TEXT NOT NULL,
    "delivery" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "giveaway_draw_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "giveaway_draw_giveawayId_sequence_key" ON "giveaway_draw"("giveawayId", "sequence");
CREATE INDEX "giveaway_draw_giveawayId_userId_idx" ON "giveaway_draw"("giveawayId", "userId");

UPDATE "foundation_revision"
SET "revision" = '0m',
    "summary" = 'Phase 5B predictions, contests, and giveaways.'
WHERE "id" = 'collective';
