-- CreateTable
CREATE TABLE "community_settings" (
    "guildId" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "community_settings_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "verification_record" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "method" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "cooldownUntil" TIMESTAMPTZ(6),
    "verifiedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "verification_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "captcha_challenge" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "answerHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "invalidatedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "captcha_challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistance_request" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(6),

    CONSTRAINT "assistance_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_panel" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "selection" TEXT NOT NULL,
    "retiredAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_panel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_panel_option" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "exclusiveGroup" TEXT,
    "prerequisiteRoleIds" JSONB NOT NULL,

    CONSTRAINT "role_panel_option_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_entitlement" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6),
    "pausedRemainingMs" INTEGER,
    "endedAt" TIMESTAMPTZ(6),
    "endReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "role_entitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linked_account" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "ownership" TEXT NOT NULL,
    "providerSubject" TEXT,
    "unlinkedAt" TIMESTAMPTZ(6),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "linked_account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "verification_record_guildId_userId_key" ON "verification_record"("guildId", "userId");

-- CreateIndex
CREATE INDEX "captcha_challenge_guildId_userId_idx" ON "captcha_challenge"("guildId", "userId");

-- CreateIndex
CREATE INDEX "assistance_request_guildId_status_idx" ON "assistance_request"("guildId", "status");

-- CreateIndex
CREATE INDEX "role_panel_guildId_idx" ON "role_panel"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "role_panel_option_panelId_roleId_key" ON "role_panel_option"("panelId", "roleId");

-- CreateIndex
CREATE INDEX "role_entitlement_expiresAt_idx" ON "role_entitlement"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "role_entitlement_guildId_userId_roleId_source_sourceId_key" ON "role_entitlement"("guildId", "userId", "roleId", "source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "linked_account_guildId_userId_provider_key" ON "linked_account"("guildId", "userId", "provider");

UPDATE "foundation_revision"
SET "revision" = '0c',
    "summary" = 'Phase 1A community: verification, role panels, entitlements, and account handles.'
WHERE "id" = 'collective';
