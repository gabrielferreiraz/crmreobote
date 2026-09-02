-- Apelido manual pra conversa de WhatsApp ainda sem contato vinculado (ver
-- app/api/whatsapp/threads/[threadId]/rename) — permite renomear o que
-- aparece na lista de Conversas mesmo em "WhatsApp Geral", sem depender só
-- do pushName que a Evolution manda (esse continua em whatsappName,
-- inalterado). Coluna nova numa tabela que já tem tenant_isolation por linha
-- desde 20260708125234_enable_row_level_security — nenhuma policy de RLS
-- nova precisa ser criada aqui.
ALTER TABLE "WhatsAppThread" ADD COLUMN "customName" TEXT;
