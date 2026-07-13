-- AlterTable: reenvio automático (remarketing) pra quem não respondeu.
ALTER TABLE "Campaign" ADD COLUMN "followUpEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Campaign" ADD COLUMN "followUpDelayHours" INTEGER NOT NULL DEFAULT 24;
ALTER TABLE "Campaign" ADD COLUMN "followUpTemplates" JSONB;

ALTER TABLE "CampaignRecipient" ADD COLUMN "followUpSentAt" TIMESTAMP(3);
ALTER TABLE "CampaignRecipient" ADD COLUMN "followUpError" TEXT;
