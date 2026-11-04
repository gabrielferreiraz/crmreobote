-- Etapa de script com vídeo (ver lib/campaigns/scripts.ts validateSteps).
-- ALTER TYPE ... ADD VALUE não roda dentro de transação em Postgres < 12;
-- IF NOT EXISTS deixa o deploy repetível.
ALTER TYPE "WhatsAppMessageType" ADD VALUE IF NOT EXISTS 'VIDEO';
