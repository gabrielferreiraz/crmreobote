ALTER TABLE "Campaign"
ADD COLUMN "scheduledAt" TIMESTAMP(3);

CREATE INDEX "Campaign_status_scheduledAt_idx"
ON "Campaign"("status", "scheduledAt");
