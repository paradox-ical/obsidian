-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "foundation_revision" (
    "id" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "recordedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "foundation_revision_pkey" PRIMARY KEY ("id")
);

-- Record the phase 0A revision. Product tables are not part of this migration.
INSERT INTO "foundation_revision" ("id", "revision", "summary")
VALUES (
    'collective',
    '0a',
    'Phase 0A foundation. Product modules are not in this schema.'
);
