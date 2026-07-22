ALTER TYPE "CampaignSource" ADD VALUE 'LEAD_CAPTURE';

ALTER TABLE "Campaign" ADD COLUMN "rmktWaves" JSONB;
ALTER TABLE "Campaign" ADD COLUMN "noReplyDays" INTEGER;
ALTER TABLE "Campaign" ADD COLUMN "targetPipelineId" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "targetStageId" TEXT;

ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_targetPipelineId_fkey"
  FOREIGN KEY ("targetPipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_targetStageId_fkey"
  FOREIGN KEY ("targetStageId") REFERENCES "PipelineStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CampaignRecipient" ADD COLUMN "nextWaveIndex" INTEGER NOT NULL DEFAULT 0;
