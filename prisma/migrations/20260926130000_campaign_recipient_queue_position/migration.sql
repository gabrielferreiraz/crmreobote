-- Fila de disparo editável: ordem de envio dos destinatários PENDENTES de uma
-- campanha (ver CampaignRecipient.queuePosition no schema e
-- lib/campaigns/queue-order.ts). Coluna opcional — null = nunca reordenado,
-- vale a ordem de criação de sempre; campanha existente segue exatamente igual
-- até alguém editar a fila. Aditiva: o código antigo ignora a coluna.
ALTER TABLE "CampaignRecipient" ADD COLUMN "queuePosition" INTEGER;

-- "Próximo pendente da campanha" (motor, a cada tick) e a lista paginada da fila.
CREATE INDEX "CampaignRecipient_campaignId_status_queuePosition_idx" ON "CampaignRecipient"("campaignId", "status", "queuePosition");
