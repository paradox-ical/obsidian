CREATE TABLE "gear_template" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "classSlug" TEXT NOT NULL DEFAULT '',
    "level" INTEGER NOT NULL DEFAULT 1,
    "binding" TEXT NOT NULL,
    "diceCount" INTEGER NOT NULL DEFAULT 0,
    "diceSides" INTEGER NOT NULL DEFAULT 0,
    "critMultiplier" INTEGER NOT NULL DEFAULT 2,
    "abilitySlug" TEXT NOT NULL DEFAULT '',
    "affixMax" INTEGER NOT NULL DEFAULT 1,
    "affixRules" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "gear_template_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "gear_template_guildId_slug_key" ON "gear_template"("guildId", "slug");
CREATE INDEX "gear_template_guildId_status_idx" ON "gear_template"("guildId", "status");

CREATE TABLE "gear_instance" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "classSlug" TEXT NOT NULL DEFAULT '',
    "level" INTEGER NOT NULL,
    "binding" TEXT NOT NULL,
    "diceCount" INTEGER NOT NULL DEFAULT 0,
    "diceSides" INTEGER NOT NULL DEFAULT 0,
    "critMultiplier" INTEGER NOT NULL DEFAULT 2,
    "abilitySlug" TEXT NOT NULL DEFAULT '',
    "affixes" JSONB NOT NULL,
    "provenance" TEXT NOT NULL,
    "equipped" BOOLEAN NOT NULL DEFAULT false,
    "lock" TEXT NOT NULL DEFAULT '',
    "destroyed" BOOLEAN NOT NULL DEFAULT false,
    "templateVersion" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "gear_instance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "gear_instance_idempotencyKey_key" ON "gear_instance"("idempotencyKey");
CREATE INDEX "gear_instance_guildId_userId_idx" ON "gear_instance"("guildId", "userId");

CREATE TABLE "test_opponent" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tactic" TEXT NOT NULL,
    "accuracy" INTEGER NOT NULL,
    "defence" INTEGER NOT NULL,
    "health" INTEGER NOT NULL,
    "diceCount" INTEGER NOT NULL,
    "diceSides" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "test_opponent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "test_opponent_guildId_slug_key" ON "test_opponent"("guildId", "slug");

CREATE TABLE "battle" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "opponentSlug" TEXT NOT NULL,
    "deadline" TIMESTAMPTZ(6),
    "state" JSONB NOT NULL,
    "winner" TEXT NOT NULL DEFAULT '',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "battle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "battle_idempotencyKey_key" ON "battle"("idempotencyKey");
CREATE INDEX "battle_guildId_userId_status_idx" ON "battle"("guildId", "userId", "status");

CREATE TABLE "battle_roll" (
    "id" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "faces" INTEGER NOT NULL,
    "result" INTEGER NOT NULL,
    "revealed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "battle_roll_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "battle_roll_battleId_sequence_key" ON "battle_roll"("battleId", "sequence");
CREATE INDEX "battle_roll_battleId_revealed_idx" ON "battle_roll"("battleId", "revealed");

CREATE TABLE "battle_action" (
    "id" TEXT NOT NULL,
    "battleId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "actor" TEXT NOT NULL,
    "move" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "battle_action_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "battle_action_idempotencyKey_key" ON "battle_action"("idempotencyKey");
CREATE INDEX "battle_action_battleId_idx" ON "battle_action"("battleId");

UPDATE "foundation_revision"
SET "revision" = '0p',
    "summary" = 'Phase 6B gear instances and the shared D20 combat engine.'
WHERE "id" = 'collective';
