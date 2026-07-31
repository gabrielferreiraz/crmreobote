-- Relatórios (app/(dashboard)/relatorios/page.tsx) agrupam WhatsAppMessage
-- por organizationId+direction+campaignId (nulo ou não) + intervalo de data,
-- sem informar threadId — nenhum índice existente cobria essa combinação.
CREATE INDEX "WhatsAppMessage_org_direction_campaign_createdAt_idx" ON "WhatsAppMessage"("organizationId", "direction", "campaignId", "createdAt");
