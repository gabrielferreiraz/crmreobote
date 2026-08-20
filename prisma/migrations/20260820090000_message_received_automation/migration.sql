-- MESSAGE_RECEIVED: gatilho de automação disparado por conteúdo de mensagem
-- de WhatsApp recebida (ver lib/automations/message-trigger.ts) — inline
-- pelo próprio webhook, não pelo cron periódico dos demais gatilhos.
ALTER TYPE "AutomationTrigger" ADD VALUE 'MESSAGE_RECEIVED';

-- Janela deslizante de rate-limit (mesma regra disparando >3x em 5min pra
-- mesma conversa) — só usado por MESSAGE_RECEIVED. O @@unique([ruleId,
-- entityId]) já existente continua garantindo que a MESMA mensagem nunca
-- dispara a MESMA regra duas vezes (entityId = messageId).
ALTER TABLE "AutomationExecution" ADD COLUMN "threadId" TEXT;
CREATE INDEX "AutomationExecution_ruleId_threadId_createdAt_idx" ON "AutomationExecution"("ruleId", "threadId", "createdAt");

-- Horário de atendimento da organização (janela única, não por regra) —
-- usado pelo modo businessHoursMode do gatilho MESSAGE_RECEIVED.
ALTER TABLE "Organization" ADD COLUMN "businessHours" JSONB;

-- Marca a origem "motor de automações" numa mensagem OUTBOUND (mesma ideia
-- que campaignId já faz pra campanha) — sustenta a detecção de "atendente
-- humano ativo recentemente" (ver hasRecentHumanMessage) e separa mensagem
-- de automação de mensagem manual nos relatórios.
ALTER TABLE "WhatsAppMessage" ADD COLUMN "automationRuleId" TEXT;
CREATE INDEX "WhatsAppMessage_organizationId_threadId_automationRuleId_idx" ON "WhatsAppMessage"("organizationId", "threadId", "automationRuleId");
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_automationRuleId_fkey" FOREIGN KEY ("automationRuleId") REFERENCES "AutomationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
