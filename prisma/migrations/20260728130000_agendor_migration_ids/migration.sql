-- Chaves de reconciliação pra migração de dados do Agendor (ver
-- scripts/import-agendor.ts) — permitem reimportar sem duplicar mesmo
-- rodando o import mais de uma vez ao longo do tempo (conforme mais
-- consultores forem migrando aos poucos, com o Agendor continuando em uso
-- em paralelo por quem ainda não migrou). Mesmo padrão de
-- WhatsAppMessage.externalId/Contact.metaLeadgenId: coluna nullable com
-- índice único, upsert por ela.

ALTER TABLE "Deal" ADD COLUMN "agendorDealId" TEXT;
CREATE UNIQUE INDEX "Deal_agendorDealId_key" ON "Deal"("agendorDealId");

ALTER TABLE "Contact" ADD COLUMN "agendorContactId" TEXT;
CREATE UNIQUE INDEX "Contact_agendorContactId_key" ON "Contact"("agendorContactId");

ALTER TABLE "Task" ADD COLUMN "agendorTaskId" TEXT;
CREATE UNIQUE INDEX "Task_agendorTaskId_key" ON "Task"("agendorTaskId");
