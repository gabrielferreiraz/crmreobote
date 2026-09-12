-- Registra quando a ÚLTIMA onda de RMKT foi de fato enviada pra cada
-- destinatário (nextWaveIndex sozinho diz QUAL onda é a próxima, mas não
-- diz QUANDO a anterior saiu). Pedido explícito: "deve mostrar também
-- quando foi enviado as ondas de rmkt".
ALTER TABLE "CampaignRecipient" ADD COLUMN "lastWaveSentAt" TIMESTAMP(3);
