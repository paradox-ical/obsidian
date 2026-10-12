-- AlterTable
ALTER TABLE "moderation_appeal" ADD COLUMN "ticketId" TEXT;

-- AlterTable
ALTER TABLE "member_report" ADD COLUMN "ticketId" TEXT;

-- CreateTable
CREATE TABLE "ticket_settings" (
    "guildId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ticket_settings_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "ticket_panel" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "categoryIds" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_panel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "openerUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "assigneeUserId" TEXT,
    "formAnswers" JSONB NOT NULL,
    "summary" TEXT,
    "policySnapshot" JSONB NOT NULL,
    "channelId" TEXT,
    "channelState" TEXT NOT NULL,
    "openedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(6),
    "closeReason" TEXT,
    "lastHumanAt" TIMESTAMPTZ(6) NOT NULL,
    "remindedAt" TIMESTAMPTZ(6),
    "reopenUntil" TIMESTAMPTZ(6),
    "contentLabel" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "support_ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_message" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorKind" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "body" TEXT,
    "contentLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_reference" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "integrationStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_reference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_panel_guildId_idx" ON "ticket_panel"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "support_ticket_guildId_number_key" ON "support_ticket"("guildId", "number");

-- CreateIndex
CREATE INDEX "support_ticket_guildId_openerUserId_status_idx" ON "support_ticket"("guildId", "openerUserId", "status");

-- CreateIndex
CREATE INDEX "ticket_message_ticketId_createdAt_idx" ON "ticket_message"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "ticket_reference_guildId_kind_idx" ON "ticket_reference"("guildId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_reference_ticketId_kind_targetId_key" ON "ticket_reference"("ticketId", "kind", "targetId");

UPDATE "foundation_revision"
SET "revision" = '0e',
    "summary" = 'Phase 1C support tickets: private intake, staff notes, and moderation links.'
WHERE "id" = 'collective';
