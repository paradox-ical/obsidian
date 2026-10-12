-- CreateTable
CREATE TABLE "progression_settings" (
    "guildId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "progression_settings_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "member_progression" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "rankBandId" TEXT,
    "lastMessageAt" TIMESTAMPTZ(6),
    "lastHash" TEXT,
    "lastHashAt" TIMESTAMPTZ(6),
    "dailyKey" TEXT,
    "dailyMessageXp" INTEGER NOT NULL DEFAULT 0,
    "dailyVoiceXp" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "member_progression_pkey" PRIMARY KEY ("guildId","userId")
);

-- CreateTable
CREATE TABLE "dossier_profile" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bio" TEXT,
    "bioPublic" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "frame" TEXT,
    "background" TEXT,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "dossier_profile_pkey" PRIMARY KEY ("guildId","userId")
);

-- CreateTable
CREATE TABLE "birthday_record" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" INTEGER,
    "day" INTEGER,
    "year" INTEGER,
    "timeZone" TEXT NOT NULL,
    "announce" BOOLEAN NOT NULL DEFAULT false,
    "editedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "birthday_record_pkey" PRIMARY KEY ("guildId","userId")
);

-- CreateTable
CREATE TABLE "invite_membership" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "inviterUserId" TEXT,
    "joinedAt" TIMESTAMPTZ(6) NOT NULL,
    "verifiedAt" TIMESTAMPTZ(6),
    "rewardedAt" TIMESTAMPTZ(6),
    "rejoin" BOOLEAN NOT NULL DEFAULT false,
    "suspicious" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "invite_membership_pkey" PRIMARY KEY ("guildId","userId")
);

-- CreateTable
CREATE TABLE "invite_event" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "inviterUserId" TEXT,
    "rejoin" BOOLEAN NOT NULL,
    "suspicious" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invite_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_event" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER,
    "ledgerStatus" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reward_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_achievement" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "earnedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "member_achievement_pkey" PRIMARY KEY ("guildId","userId","achievementId")
);

-- CreateTable
CREATE TABLE "commendation" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "commendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_session" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "lastAwardedAt" TIMESTAMPTZ(6) NOT NULL,
    "eligibleHumans" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "voice_session_pkey" PRIMARY KEY ("guildId","userId")
);

-- CreateIndex
CREATE INDEX "invite_membership_guildId_inviterUserId_idx" ON "invite_membership"("guildId", "inviterUserId");

-- CreateIndex
CREATE INDEX "invite_event_guildId_createdAt_idx" ON "invite_event"("guildId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reward_event_idempotencyKey_key" ON "reward_event"("idempotencyKey");

-- CreateIndex
CREATE INDEX "reward_event_guildId_userId_source_idx" ON "reward_event"("guildId", "userId", "source");

-- CreateIndex
CREATE INDEX "commendation_guildId_fromUserId_toUserId_idx" ON "commendation"("guildId", "fromUserId", "toUserId");

UPDATE "foundation_revision"
SET "revision" = '0f',
    "summary" = 'Phase 2A progression: XP, dossiers, invites, birthdays, and achievements.'
WHERE "id" = 'collective';
