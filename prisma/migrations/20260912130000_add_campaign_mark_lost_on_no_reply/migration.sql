-- Liga/desliga (por campanha) marcar o negócio como perdido automaticamente
-- quando "não respondeu" vencer (Campaign.noReplyDays) — pedido explícito:
-- "a opção de colocar 'não respondeu' em perdido deve estar com uma opção
-- de dar perdido ou não (hoje em dia não tem como)".
ALTER TABLE "Campaign" ADD COLUMN "markLostOnNoReply" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Campaign" ADD COLUMN "noReplyLossReasonId" TEXT;

ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_noReplyLossReasonId_fkey"
  FOREIGN KEY ("noReplyLossReasonId") REFERENCES "LossReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;
