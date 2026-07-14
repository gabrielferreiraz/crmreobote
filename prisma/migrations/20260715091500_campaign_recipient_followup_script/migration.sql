-- Script sorteado no reenvio (remarketing) — separado do envio inicial (scriptId).
ALTER TABLE "CampaignRecipient" ADD COLUMN "followUpScriptId" TEXT;
