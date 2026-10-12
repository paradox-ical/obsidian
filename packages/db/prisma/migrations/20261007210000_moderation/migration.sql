-- CreateTable
CREATE TABLE "moderation_policy" (
    "guildId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "moderation_policy_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "moderation_case" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "failureReason" TEXT,
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "ruleId" TEXT,
    "ruleVersion" INTEGER,
    "points" INTEGER NOT NULL DEFAULT 0,
    "relatedCaseId" TEXT,
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "moderation_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warning_point" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warning_point_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_appeal" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "resolution" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(6),

    CONSTRAINT "moderation_appeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_report" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "reporterUserId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "ticketStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_log" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "channelId" TEXT,
    "actorUserId" TEXT,
    "actorConfidence" TEXT NOT NULL,
    "targetId" TEXT,
    "content" TEXT,
    "contentLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retainUntil" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "staff_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_signal" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT,
    "kind" TEXT NOT NULL,
    "contentHash" TEXT,
    "mentionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_signal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "moderation_case_guildId_targetUserId_idx" ON "moderation_case"("guildId", "targetUserId");

-- CreateIndex
CREATE INDEX "warning_point_guildId_userId_status_idx" ON "warning_point"("guildId", "userId", "status");

-- CreateIndex
CREATE INDEX "moderation_appeal_guildId_caseId_idx" ON "moderation_appeal"("guildId", "caseId");

-- CreateIndex
CREATE INDEX "member_report_guildId_reporterUserId_idx" ON "member_report"("guildId", "reporterUserId");

-- CreateIndex
CREATE INDEX "staff_log_guildId_createdAt_idx" ON "staff_log"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "staff_log_retainUntil_idx" ON "staff_log"("retainUntil");

-- CreateIndex
CREATE INDEX "moderation_signal_guildId_kind_createdAt_idx" ON "moderation_signal"("guildId", "kind", "createdAt");

UPDATE "foundation_revision"
SET "revision" = '0d',
    "summary" = 'Phase 1B moderation: automation, cases, warnings, appeals, and staff logs.'
WHERE "id" = 'collective';
