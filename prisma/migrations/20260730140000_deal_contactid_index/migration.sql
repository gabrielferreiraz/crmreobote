-- Achar negócio(s) de um contato não tinha índice cobrindo contactId — usado
-- pelo EXISTS de Relatórios (dealThreads) e por lib/campaigns/reply.ts a
-- cada mensagem WhatsApp recebida vinculada a negócio de campanha.
CREATE INDEX "Deal_organizationId_contactId_idx" ON "Deal"("organizationId", "contactId");
