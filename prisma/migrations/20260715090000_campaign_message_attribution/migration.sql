-- WhatsAppMessage: marca a mensagem enviada pelo motor de campanhas (lista fria),
-- pra separar dos relatórios gerais de atividade sem heurística de conteúdo/horário.
ALTER TABLE "WhatsAppMessage" ADD COLUMN "campaignId" TEXT;
CREATE INDEX "WhatsAppMessage_organizationId_campaignId_idx" ON "WhatsAppMessage"("organizationId", "campaignId");
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CampaignRecipient: qual script foi sorteado pra esse destinatário (quebra por script nos relatórios).
ALTER TABLE "CampaignRecipient" ADD COLUMN "scriptId" TEXT;
