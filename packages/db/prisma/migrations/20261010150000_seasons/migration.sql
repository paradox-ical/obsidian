-- CreateTable
CREATE TABLE "season_settings" (
    "guildId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "season_settings_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "season_state" (
    "guildId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6) NOT NULL,
    "rolledFrom" TEXT,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "season_state_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "seasonal_score" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "seals" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "seasonal_score_pkey" PRIMARY KEY ("guildId","userId","seasonId")
);

-- CreateTable
CREATE TABLE "lifetime_score" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seals" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lifetime_score_pkey" PRIMARY KEY ("guildId","userId")
);

-- CreateTable
CREATE TABLE "season_archive" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "availability" TEXT NOT NULL,
    "standings" JSONB NOT NULL,
    "preservation" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "season_archive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "anonymous" BOOLEAN NOT NULL,
    "eligibleRoleIds" JSONB NOT NULL,
    "opensAt" TIMESTAMPTZ(6) NOT NULL,
    "closesAt" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_choice" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "poll_choice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_vote" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "choiceId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temp_room" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "privacy" TEXT NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "capacity" INTEGER NOT NULL DEFAULT 10,
    "occupants" JSONB NOT NULL,
    "invitedUserIds" JSONB NOT NULL,
    "lastHumanAt" TIMESTAMPTZ(6) NOT NULL,
    "emptySince" TIMESTAMPTZ(6),
    "channelId" TEXT,
    "channelState" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "closeReason" TEXT,
    "missionHold" BOOLEAN NOT NULL DEFAULT false,
    "needsStaff" BOOLEAN NOT NULL DEFAULT false,
    "disconnectState" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(6),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "temp_room_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "seasonal_score_guildId_seasonId_idx" ON "seasonal_score"("guildId", "seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "season_archive_guildId_seasonId_category_key" ON "season_archive"("guildId", "seasonId", "category");

-- CreateIndex
CREATE INDEX "poll_guildId_status_idx" ON "poll"("guildId", "status");

-- CreateIndex
CREATE INDEX "poll_choice_pollId_idx" ON "poll_choice"("pollId");

-- CreateIndex
CREATE UNIQUE INDEX "poll_vote_pollId_userId_choiceId_key" ON "poll_vote"("pollId", "userId", "choiceId");

-- CreateIndex
CREATE INDEX "poll_vote_pollId_idx" ON "poll_vote"("pollId");

-- CreateIndex
CREATE INDEX "temp_room_guildId_status_kind_idx" ON "temp_room"("guildId", "status", "kind");

UPDATE "foundation_revision"
SET "revision" = '0g',
    "summary" = 'Phase 2B seasons, leaderboards, staff polls, and temporary rooms.'
WHERE "id" = 'collective';
