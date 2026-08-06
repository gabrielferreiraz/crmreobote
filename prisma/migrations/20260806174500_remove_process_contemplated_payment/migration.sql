-- Remove os marcadores "Contemplado" e "Falta pagar" do Processo — não
-- fazem mais sentido no fluxo atual (ver conversa que motivou a remoção).
ALTER TABLE "Process" DROP COLUMN "contemplated";
ALTER TABLE "Process" DROP COLUMN "contemplatedAt";
ALTER TABLE "Process" DROP COLUMN "paymentPending";
