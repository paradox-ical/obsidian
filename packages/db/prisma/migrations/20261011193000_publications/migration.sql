-- CreateTable
CREATE TABLE "publication_template" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publication_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_draft" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "committedRevision" INTEGER,
    "status" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "templateId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "publication_draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_review" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "channelId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "delivery" TEXT NOT NULL,
    "preview" JSONB NOT NULL,
    "controls" JSONB NOT NULL,
    "feedback" TEXT,
    "actorUserId" TEXT,
    "decidedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publication_review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_message" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "destinationChannelId" TEXT NOT NULL,
    "discordMessageId" TEXT,
    "delivery" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "approverUserId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMPTZ(6),
    "publishedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publication_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_history" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "approverUserId" TEXT NOT NULL,
    "recordedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "publication_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "publication_template_guildId_name_idx" ON "publication_template"("guildId", "name");

-- CreateIndex
CREATE INDEX "publication_draft_guildId_status_idx" ON "publication_draft"("guildId", "status");

-- CreateIndex
CREATE INDEX "publication_review_guildId_draftId_status_idx" ON "publication_review"("guildId", "draftId", "status");

-- CreateIndex
CREATE INDEX "publication_message_guildId_status_idx" ON "publication_message"("guildId", "status");

-- CreateIndex
CREATE INDEX "publication_message_draftId_status_idx" ON "publication_message"("draftId", "status");

-- CreateIndex
CREATE INDEX "publication_history_messageId_revision_idx" ON "publication_history"("messageId", "revision");

UPDATE "foundation_revision"
SET "revision" = '0j',
    "summary" = 'Phase 4A publication drafts, review, and exact-revision approval.'
WHERE "id" = 'collective';
