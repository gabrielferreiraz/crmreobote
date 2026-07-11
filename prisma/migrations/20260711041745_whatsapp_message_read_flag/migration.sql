-- AlterTable
ALTER TABLE "WhatsAppMessage" ADD COLUMN "read" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: mensagens que já existem antes desta migração não são "novidade"
-- pra ninguém — marca tudo como lido pra não gerar uma onda de sinalzinhos
-- de "não lido" no dia do deploy.
UPDATE "WhatsAppMessage" SET "read" = true;

-- CreateIndex
CREATE INDEX "WhatsAppMessage_organizationId_contactId_direction_read_idx" ON "WhatsAppMessage"("organizationId", "contactId", "direction", "read");
