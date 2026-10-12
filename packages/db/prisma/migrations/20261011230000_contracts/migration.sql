CREATE TABLE "contract_definition" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "band" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "rewardMarks" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "answerHash" TEXT NOT NULL DEFAULT '',
    "dailyPool" BOOLEAN NOT NULL DEFAULT false,
    "weeklyPool" BOOLEAN NOT NULL DEFAULT false,
    "monthlyPool" BOOLEAN NOT NULL DEFAULT false,
    "availability" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "contract_definition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contract_definition_guildId_slug_key" ON "contract_definition"("guildId", "slug");
CREATE INDEX "contract_definition_guildId_status_idx" ON "contract_definition"("guildId", "status");

CREATE TABLE "contract_revision" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "band" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "rewardMarks" INTEGER NOT NULL,
    "answerHash" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contract_revision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contract_revision_definitionId_version_key" ON "contract_revision"("definitionId", "version");
CREATE INDEX "contract_revision_guildId_definitionId_idx" ON "contract_revision"("guildId", "definitionId");

CREATE TABLE "contract_board_slot" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "board" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "definitionId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "band" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "rewardMarks" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contract_board_slot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contract_board_slot_guildId_board_cycleId_slot_key" ON "contract_board_slot"("guildId", "board", "cycleId", "slot");
CREATE INDEX "contract_board_slot_guildId_board_cycleId_idx" ON "contract_board_slot"("guildId", "board", "cycleId");

CREATE TABLE "contract_assignment" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "board" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "definitionId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "rewardMarks" INTEGER NOT NULL,
    "payoutMarks" INTEGER NOT NULL DEFAULT 0,
    "payoutStatus" TEXT NOT NULL DEFAULT 'pending',
    "status" TEXT NOT NULL,
    "rewardKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "contract_assignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contract_assignment_rewardKey_key" ON "contract_assignment"("rewardKey");
CREATE UNIQUE INDEX "contract_assignment_live_slot" ON "contract_assignment"("guildId", "userId", "cycleId", "slot") WHERE "status" <> 'rerolled';
CREATE INDEX "contract_assignment_guildId_userId_cycleId_idx" ON "contract_assignment"("guildId", "userId", "cycleId");
CREATE INDEX "contract_assignment_guildId_userId_status_idx" ON "contract_assignment"("guildId", "userId", "status");

CREATE TABLE "contract_reroll" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contract_reroll_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contract_reroll_guildId_userId_cycleId_key" ON "contract_reroll"("guildId", "userId", "cycleId");

CREATE TABLE "contract_preference" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshDaily" BOOLEAN NOT NULL DEFAULT true,
    "refreshWeekly" BOOLEAN NOT NULL DEFAULT false,
    "refreshMonthly" BOOLEAN NOT NULL DEFAULT false,
    "delivery" TEXT NOT NULL DEFAULT 'dm',
    "channelId" TEXT NOT NULL DEFAULT '',
    "completionPings" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "contract_preference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contract_preference_guildId_userId_key" ON "contract_preference"("guildId", "userId");

CREATE TABLE "contract_notice" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "board" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL DEFAULT '',
    "delivery" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "publicBody" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "contract_notice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contract_notice_guildId_userId_kind_cycleId_assignmentId_key" ON "contract_notice"("guildId", "userId", "kind", "cycleId", "assignmentId");
CREATE INDEX "contract_notice_guildId_status_idx" ON "contract_notice"("guildId", "status");

CREATE TABLE "contract_submission" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "contract_submission_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "contract_submission_assignmentId_status_idx" ON "contract_submission"("assignmentId", "status");
CREATE INDEX "contract_submission_guildId_status_idx" ON "contract_submission"("guildId", "status");

CREATE TABLE "contract_settings" (
    "guildId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Australia/Perth',
    "completionChannelId" TEXT NOT NULL DEFAULT '',
    "dailyCount" INTEGER NOT NULL DEFAULT 3,
    "dailyCap" INTEGER NOT NULL DEFAULT 80,
    "weeklyCap" INTEGER NOT NULL DEFAULT 250,
    "monthlyCap" INTEGER NOT NULL DEFAULT 500,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "contract_settings_pkey" PRIMARY KEY ("guildId")
);

CREATE TABLE "contract_cursor" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMPTZ(6),
    "lastHash" TEXT NOT NULL DEFAULT '',
    "lastHashAt" TIMESTAMPTZ(6),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "contract_cursor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contract_cursor_guildId_userId_key" ON "contract_cursor"("guildId", "userId");

UPDATE "foundation_revision"
SET "revision" = '0n',
    "summary" = 'Phase 5C personalised contracts, shared boards, and routine payout caps.'
WHERE "id" = 'collective';
