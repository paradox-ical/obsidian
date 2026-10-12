-- Phase 4B announcements, pins, stickies, replies, and game-update feeds.

CREATE TABLE "announcement_series" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "approvedRevision" INTEGER NOT NULL,
    "destination" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "hour" INTEGER NOT NULL,
    "minute" INTEGER NOT NULL,
    "weekday" INTEGER,
    "dayOfMonth" INTEGER,
    "endsAt" TIMESTAMPTZ(6),
    "removeAfterMinutes" INTEGER,
    "status" TEXT NOT NULL,
    "nextRunAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "announcement_series_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "announcement_series_guildId_status_nextRunAt_idx" ON "announcement_series"("guildId", "status", "nextRunAt");

CREATE TABLE "announcement_delivery" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "occurrenceKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "delivery" TEXT NOT NULL,
    "discordMessageId" TEXT,
    "expiresAt" TIMESTAMPTZ(6),
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_delivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "announcement_delivery_seriesId_occurrenceKey_key" ON "announcement_delivery"("seriesId", "occurrenceKey");
CREATE INDEX "announcement_delivery_guildId_createdAt_idx" ON "announcement_delivery"("guildId", "createdAt");

CREATE TABLE "managed_pin" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "delivery" TEXT NOT NULL,
    "discordMessageId" TEXT,
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "managed_pin_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "managed_pin_guildId_channelId_status_idx" ON "managed_pin"("guildId", "channelId", "status");

CREATE TABLE "sticky_channel" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "cooldownMs" INTEGER NOT NULL,
    "humanCount" INTEGER NOT NULL DEFAULT 0,
    "lastPostedAt" TIMESTAMPTZ(6),
    "currentDeliveryId" TEXT,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sticky_channel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sticky_channel_guildId_channelId_key" ON "sticky_channel"("guildId", "channelId");

CREATE TABLE "sticky_delivery" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "stickyId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "delivery" TEXT NOT NULL,
    "discordMessageId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sticky_delivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sticky_delivery_stickyId_status_idx" ON "sticky_delivery"("stickyId", "status");

CREATE TABLE "reply_rule" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "channelIds" JSONB NOT NULL,
    "excludedChannelIds" JSONB NOT NULL,
    "roleIds" JSONB NOT NULL,
    "excludedRoleIds" JSONB NOT NULL,
    "variants" JSONB NOT NULL,
    "visibility" TEXT NOT NULL,
    "secret" BOOLEAN NOT NULL DEFAULT false,
    "cooldownMs" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reply_rule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reply_rule_guildId_status_priority_idx" ON "reply_rule"("guildId", "status", "priority");

CREATE TABLE "reply_cooldown" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "lastAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reply_cooldown_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reply_cooldown_ruleId_scope_subjectId_key" ON "reply_cooldown"("ruleId", "scope", "subjectId");

CREATE TABLE "reply_log" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reply_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reply_log_guildId_createdAt_idx" ON "reply_log"("guildId", "createdAt");

CREATE TABLE "feed_source" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "url" TEXT NOT NULL DEFAULT '',
    "mode" TEXT NOT NULL,
    "destination" TEXT NOT NULL DEFAULT '',
    "lastExternalId" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feed_source_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "feed_source_guildId_status_idx" ON "feed_source"("guildId", "status");

CREATE TABLE "feed_item" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "canonical" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "draftId" TEXT,
    "delivery" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_item_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "feed_item_sourceId_externalId_key" ON "feed_item"("sourceId", "externalId");
CREATE INDEX "feed_item_guildId_createdAt_idx" ON "feed_item"("guildId", "createdAt");

CREATE TABLE "distribution_alert" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "delivery" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distribution_alert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "distribution_alert_guildId_createdAt_idx" ON "distribution_alert"("guildId", "createdAt");

UPDATE "foundation_revision"
SET "revision" = '0k',
    "summary" = 'Phase 4B announcements, pins, stickies, replies, and game-update feeds.'
WHERE "id" = 'collective';
