-- Phase 5A official events, persistent crews, and session LFG.

CREATE TABLE "event_template" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "links" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "waitlist" BOOLEAN NOT NULL,
    "rewardMarks" INTEGER NOT NULL,
    "rewardBudget" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "event_template_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "event_template_guildId_name_idx" ON "event_template"("guildId", "name");

CREATE TABLE "event_series" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "templateId" TEXT,
    "name" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "links" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "hour" INTEGER NOT NULL,
    "minute" INTEGER NOT NULL,
    "weekday" INTEGER,
    "dayOfMonth" INTEGER,
    "endsAt" TIMESTAMPTZ(6),
    "capacity" INTEGER NOT NULL,
    "waitlist" BOOLEAN NOT NULL,
    "rewardMarks" INTEGER NOT NULL,
    "rewardBudget" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "nextStartsAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "event_series_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "event_series_guildId_status_nextStartsAt_idx" ON "event_series"("guildId", "status", "nextStartsAt");

CREATE TABLE "event_occurrence" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "occurrenceKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "links" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "waitlist" BOOLEAN NOT NULL,
    "rewardMarks" INTEGER NOT NULL,
    "rewardBudget" INTEGER NOT NULL,
    "rewardSpent" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "detached" BOOLEAN NOT NULL DEFAULT false,
    "recap" TEXT NOT NULL DEFAULT '',
    "discordEventId" TEXT,
    "syncStatus" TEXT NOT NULL,
    "syncReason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "event_occurrence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "event_occurrence_seriesId_occurrenceKey_key" ON "event_occurrence"("seriesId", "occurrenceKey");
CREATE INDEX "event_occurrence_guildId_startsAt_idx" ON "event_occurrence"("guildId", "startsAt");

CREATE TABLE "event_rsvp" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "seat" TEXT NOT NULL,
    "checkedIn" BOOLEAN NOT NULL DEFAULT false,
    "attended" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "event_rsvp_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "event_rsvp_occurrenceId_userId_key" ON "event_rsvp"("occurrenceId", "userId");
CREATE INDEX "event_rsvp_occurrenceId_seat_idx" ON "event_rsvp"("occurrenceId", "seat");

CREATE TABLE "event_sync" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "discordEventId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_sync_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "event_sync_occurrenceId_createdAt_idx" ON "event_sync"("occurrenceId", "createdAt");

CREATE TABLE "event_link" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_link_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "event_link_occurrenceId_kind_targetId_key" ON "event_link"("occurrenceId", "kind", "targetId");

CREATE TABLE "event_reminder" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "offsetMinutes" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "delivery" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_reminder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "event_reminder_occurrenceId_offsetMinutes_key" ON "event_reminder"("occurrenceId", "offsetMinutes");

CREATE TABLE "crew" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "leaderUserId" TEXT NOT NULL,
    "rewardMarks" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "crew_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "crew_guildId_status_idx" ON "crew"("guildId", "status");

CREATE TABLE "crew_member" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "crew_member_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crew_member_crewId_userId_key" ON "crew_member"("crewId", "userId");
CREATE INDEX "crew_member_guildId_userId_idx" ON "crew_member"("guildId", "userId");

CREATE TABLE "crew_history" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crew_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "crew_history_crewId_createdAt_idx" ON "crew_history"("crewId", "createdAt");

CREATE TABLE "crew_session" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "crewId" TEXT,
    "name" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "size" INTEGER NOT NULL,
    "joinMode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "roomId" TEXT,
    "rewardKey" TEXT NOT NULL,
    "rpgStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "crew_session_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "crew_session_guildId_status_startsAt_idx" ON "crew_session"("guildId", "status", "startsAt");

CREATE TABLE "crew_session_member" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "team" TEXT NOT NULL DEFAULT '',
    "attended" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "crew_session_member_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crew_session_member_sessionId_userId_key" ON "crew_session_member"("sessionId", "userId");
CREATE INDEX "crew_session_member_sessionId_status_idx" ON "crew_session_member"("sessionId", "status");

UPDATE "foundation_revision"
SET "revision" = '0l',
    "summary" = 'Phase 5A official events, persistent crews, and session LFG.'
WHERE "id" = 'collective';
