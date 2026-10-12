-- CreateTable
CREATE TABLE "guild" (
    "guildId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Australia/Perth',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "guild_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "config_version" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(6),

    CONSTRAINT "config_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capability_grant" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,

    CONSTRAINT "capability_grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_grant" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,

    CONSTRAINT "dashboard_grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flag" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "maintenance" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feature_flag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_record" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job" (
    "id" TEXT NOT NULL,
    "guildId" TEXT,
    "jobType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "runAt" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMPTZ(6),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_message" (
    "id" TEXT NOT NULL,
    "guildId" TEXT,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL,
    "availableAt" TIMESTAMPTZ(6) NOT NULL,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMPTZ(6),
    "lastError" TEXT,
    "deliveredAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interaction_session" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "requiredCapability" TEXT,
    "purpose" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interaction_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_state" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_attempt" (
    "id" TEXT NOT NULL,
    "subjectHash" TEXT NOT NULL,
    "windowStart" TIMESTAMPTZ(6) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "auth_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "config_version_guildId_state_idx" ON "config_version"("guildId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "config_version_guildId_version_key" ON "config_version"("guildId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "capability_grant_guildId_roleId_capability_key" ON "capability_grant"("guildId", "roleId", "capability");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_grant_guildId_kind_subjectId_key" ON "dashboard_grant"("guildId", "kind", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flag_guildId_moduleKey_key" ON "feature_flag"("guildId", "moduleKey");

-- CreateIndex
CREATE INDEX "audit_record_guildId_createdAt_idx" ON "audit_record"("guildId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "job_idempotencyKey_key" ON "job"("idempotencyKey");

-- CreateIndex
CREATE INDEX "job_status_runAt_idx" ON "job"("status", "runAt");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_message_idempotencyKey_key" ON "outbox_message"("idempotencyKey");

-- CreateIndex
CREATE INDEX "outbox_message_status_availableAt_idx" ON "outbox_message"("status", "availableAt");

-- CreateIndex
CREATE INDEX "interaction_session_guildId_actorUserId_idx" ON "interaction_session"("guildId", "actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_state_stateHash_key" ON "oauth_state"("stateHash");

-- CreateIndex
CREATE UNIQUE INDEX "admin_session_tokenHash_key" ON "admin_session"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "auth_attempt_subjectHash_windowStart_key" ON "auth_attempt"("subjectHash", "windowStart");

UPDATE "foundation_revision"
SET "revision" = '0b',
    "summary" = 'Phase 0B operations: jobs, outbox, sessions, guild configuration, and admin auth.'
WHERE "id" = 'collective';
