ALTER TABLE "contract_definition" ADD COLUMN "characterXp" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "contract_revision" ADD COLUMN "characterXp" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "contract_assignment" ADD COLUMN "characterXp" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "character_curve" (
    "guildId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "xpFactor" INTEGER NOT NULL DEFAULT 100,
    "sessionXp" INTEGER NOT NULL DEFAULT 1200,
    "sessionsPerWeek" INTEGER NOT NULL DEFAULT 4,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "character_curve_pkey" PRIMARY KEY ("guildId")
);

CREATE TABLE "class_definition" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "baseStrength" INTEGER NOT NULL,
    "baseAgility" INTEGER NOT NULL,
    "baseEndurance" INTEGER NOT NULL,
    "baseFocus" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "class_definition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "class_definition_guildId_slug_key" ON "class_definition"("guildId", "slug");
CREATE INDEX "class_definition_guildId_status_idx" ON "class_definition"("guildId", "status");

CREATE TABLE "class_ability" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "unlockLevel" INTEGER NOT NULL,
    "cooldownTurns" INTEGER NOT NULL,
    "targetRule" TEXT NOT NULL,
    "formula" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "class_ability_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "class_ability_classId_slug_key" ON "class_ability"("classId", "slug");
CREATE INDEX "class_ability_guildId_classId_idx" ON "class_ability"("guildId", "classId");

CREATE TABLE "player_character" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "classSlug" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "unspentPoints" INTEGER NOT NULL DEFAULT 0,
    "strength" INTEGER NOT NULL DEFAULT 0,
    "agility" INTEGER NOT NULL DEFAULT 0,
    "endurance" INTEGER NOT NULL DEFAULT 0,
    "focus" INTEGER NOT NULL DEFAULT 0,
    "pendingXp" INTEGER NOT NULL DEFAULT 0,
    "respecAvailableAt" TIMESTAMPTZ(6),
    "classChangeAvailableAt" TIMESTAMPTZ(6),
    "introResetUsed" BOOLEAN NOT NULL DEFAULT false,
    "rankedDebutAt" TIMESTAMPTZ(6),
    "gameplayLock" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "player_character_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "player_character_guildId_userId_key" ON "player_character"("guildId", "userId");
CREATE INDEX "player_character_guildId_classSlug_idx" ON "player_character"("guildId", "classSlug");

CREATE TABLE "character_loadout_slot" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'class',
    "abilityId" TEXT NOT NULL DEFAULT '',
    "itemId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "character_loadout_slot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "character_loadout_slot_guildId_userId_slot_key" ON "character_loadout_slot"("guildId", "userId", "slot");

CREATE TABLE "character_reward" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rewardKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "character_reward_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "character_reward_rewardKey_key" ON "character_reward"("rewardKey");
CREATE INDEX "character_reward_guildId_userId_idx" ON "character_reward"("guildId", "userId");

CREATE TABLE "character_held_item" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "classSlug" TEXT NOT NULL DEFAULT '',
    "abilitySlug" TEXT NOT NULL DEFAULT '',
    "equipped" BOOLEAN NOT NULL DEFAULT true,
    "destroyed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "character_held_item_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "character_held_item_guildId_userId_idx" ON "character_held_item"("guildId", "userId");

CREATE TABLE "character_xp_event" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "character_xp_event_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "character_xp_event_idempotencyKey_key" ON "character_xp_event"("idempotencyKey");
CREATE INDEX "character_xp_event_guildId_userId_idx" ON "character_xp_event"("guildId", "userId");

UPDATE "foundation_revision"
SET "revision" = '0o',
    "summary" = 'Phase 6A character progression, classes, stat points, and paid resets.'
WHERE "id" = 'collective';
