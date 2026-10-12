-- AlterTable
ALTER TABLE "role_panel_option" ADD COLUMN "emoji" TEXT;

-- CreateTable
CREATE TABLE "role_panel_post" (
    "messageId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "panelId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_panel_post_pkey" PRIMARY KEY ("messageId")
);

-- CreateIndex
CREATE INDEX "role_panel_post_panelId_idx" ON "role_panel_post"("panelId");
