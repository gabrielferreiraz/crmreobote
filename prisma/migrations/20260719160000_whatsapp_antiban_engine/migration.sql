-- Motor anti-banimento do WhatsApp: aquecimento de número, suspensão de
-- contato que nunca respondeu (opt-out/cold-streak) e pausa automática por
-- instabilidade de conexão. Aditivo: só colunas nullable/default em tabelas
-- já existentes — nenhuma policy de RLS muda (RLS é por linha, não por
-- coluna; as policies de WhatsAppInstance/Contact já existentes cobrem as
-- colunas novas automaticamente).

ALTER TABLE "WhatsAppInstance" ADD COLUMN "proxyHost" TEXT;
ALTER TABLE "WhatsAppInstance" ADD COLUMN "proxyPort" INTEGER;
ALTER TABLE "WhatsAppInstance" ADD COLUMN "proxyProtocol" TEXT;
ALTER TABLE "WhatsAppInstance" ADD COLUMN "proxyUsername" TEXT;
ALTER TABLE "WhatsAppInstance" ADD COLUMN "proxyPasswordEncrypted" TEXT;
ALTER TABLE "WhatsAppInstance" ADD COLUMN "firstConnectedAt" TIMESTAMP(3);
ALTER TABLE "WhatsAppInstance" ADD COLUMN "recentDisconnectCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WhatsAppInstance" ADD COLUMN "riskWindowStartedAt" TIMESTAMP(3);

ALTER TABLE "Contact" ADD COLUMN "whatsappOptOutAt" TIMESTAMP(3);

-- Backfill: instância já conectada antes deste recurso existir é tratada
-- como já aquecida (30 dias > os 7 dias da rampa) — nunca derruba de
-- repente o volume de quem já operava normalmente. Instância desconectada
-- fica com firstConnectedAt null; recebe o valor de verdade na próxima vez
-- que conectar (ver lib/whatsapp/events.ts).
UPDATE "WhatsAppInstance" SET "firstConnectedAt" = now() - interval '30 days' WHERE status = 'CONNECTED';
