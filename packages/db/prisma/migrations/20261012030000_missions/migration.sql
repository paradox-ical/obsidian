CREATE TABLE "mission_run" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "waiting" TEXT NOT NULL,
    "unbanked" JSONB NOT NULL,
    "log" JSONB NOT NULL,
    "reservedItemIds" JSONB NOT NULL,
    "notice" TEXT NOT NULL DEFAULT '',
    "grantedXp" INTEGER NOT NULL DEFAULT 0,
    "grantedMarks" INTEGER NOT NULL DEFAULT 0,
    "marksResult" TEXT NOT NULL DEFAULT '',
    "rewardsPosted" BOOLEAN NOT NULL DEFAULT false,
    "dayKey" TEXT NOT NULL DEFAULT '',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "mission_run_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mission_run_idempotencyKey_key" ON "mission_run"("idempotencyKey");
CREATE INDEX "mission_run_guildId_userId_status_idx" ON "mission_run"("guildId", "userId", "status");

CREATE TABLE "crew_mission" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "regionSlug" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "turnUserId" TEXT NOT NULL DEFAULT '',
    "turnDeadline" TIMESTAMPTZ(6),
    "abandonAt" TIMESTAMPTZ(6) NOT NULL,
    "enemy" JSONB NOT NULL,
    "enemyHealth" INTEGER NOT NULL DEFAULT 0,
    "roomId" TEXT NOT NULL DEFAULT '',
    "rules" TEXT NOT NULL,
    "notice" TEXT NOT NULL DEFAULT '',
    "granted" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "crew_mission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crew_mission_idempotencyKey_key" ON "crew_mission"("idempotencyKey");
CREATE INDEX "crew_mission_guildId_status_abandonAt_idx" ON "crew_mission"("guildId", "status", "abandonAt");

CREATE TABLE "crew_mission_member" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "misses" INTEGER NOT NULL DEFAULT 0,
    "health" INTEGER NOT NULL,
    "downed" BOOLEAN NOT NULL DEFAULT false,
    "revivesUsed" INTEGER NOT NULL DEFAULT 0,
    "eligible" BOOLEAN NOT NULL DEFAULT true,
    "acted" BOOLEAN NOT NULL DEFAULT false,
    "lootSlug" TEXT NOT NULL DEFAULT '',
    "grantedXp" INTEGER NOT NULL DEFAULT 0,
    "reservedItemIds" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "crew_mission_member_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crew_mission_member_missionId_userId_key" ON "crew_mission_member"("missionId", "userId");
CREATE INDEX "crew_mission_member_guildId_userId_idx" ON "crew_mission_member"("guildId", "userId");

CREATE TABLE "recovery" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "until" TIMESTAMPTZ(6) NOT NULL,
    "medkitUsed" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "recovery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "recovery_guildId_userId_key" ON "recovery"("guildId", "userId");

UPDATE "foundation_revision"
SET "revision" = '0r',
    "summary" = 'Phase 7B interactive missions, crew missions, and recovery.'
WHERE "id" = 'collective';
