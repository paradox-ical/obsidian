CREATE TABLE "world_region" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "world_region_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "world_region_guildId_slug_key" ON "world_region"("guildId", "slug");

CREATE TABLE "world_enemy" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regionSlug" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "boss" BOOLEAN NOT NULL,
    "ability" TEXT NOT NULL,
    "accuracy" INTEGER NOT NULL,
    "defence" INTEGER NOT NULL,
    "health" INTEGER NOT NULL,
    "diceCount" INTEGER NOT NULL,
    "diceSides" INTEGER NOT NULL,
    "rewardSource" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "world_enemy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "world_enemy_guildId_slug_key" ON "world_enemy"("guildId", "slug");
CREATE INDEX "world_enemy_guildId_regionSlug_idx" ON "world_enemy"("guildId", "regionSlug");

CREATE TABLE "loot_table" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regionSlug" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "entries" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "loot_table_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "loot_table_guildId_slug_key" ON "loot_table"("guildId", "slug");

CREATE TABLE "expedition" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "regionSlug" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "deadline" TIMESTAMPTZ(6) NOT NULL,
    "cooldownUntil" TIMESTAMPTZ(6) NOT NULL,
    "dayKey" TEXT NOT NULL DEFAULT '',
    "notify" BOOLEAN NOT NULL DEFAULT false,
    "notice" TEXT NOT NULL DEFAULT '',
    "reservedItemIds" JSONB NOT NULL,
    "rules" JSONB NOT NULL,
    "report" JSONB NOT NULL,
    "grantedXp" INTEGER NOT NULL DEFAULT 0,
    "grantedMarks" INTEGER NOT NULL DEFAULT 0,
    "marksResult" TEXT NOT NULL DEFAULT '',
    "rewardsPosted" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "expedition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "expedition_idempotencyKey_key" ON "expedition"("idempotencyKey");
CREATE INDEX "expedition_guildId_userId_status_idx" ON "expedition"("guildId", "userId", "status");
CREATE INDEX "expedition_status_deadline_idx" ON "expedition"("status", "deadline");

UPDATE "foundation_revision"
SET "revision" = '0q',
    "summary" = 'Phase 7A regions, timed expeditions, enemies, and loot tables.'
WHERE "id" = 'collective';
