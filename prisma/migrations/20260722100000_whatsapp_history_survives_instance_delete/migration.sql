-- Histórico de WhatsApp (conversas/mensagens) não pode mais ser destruído
-- quando a WhatsAppInstance é apagada de verdade (ver
-- lib/whatsapp/instance-cleanup.ts's deleteInstanceForInactiveUser, chamado
-- quando um usuário é desativado) — antes disso, o FK em CASCADE apagava
-- silenciosamente toda a conversa junto com a instância.

-- WhatsAppThread.instanceId: Cascade -> SetNull
ALTER TABLE "WhatsAppThread" DROP CONSTRAINT "WhatsAppThread_instanceId_fkey";
ALTER TABLE "WhatsAppThread" ALTER COLUMN "instanceId" DROP NOT NULL;
ALTER TABLE "WhatsAppThread" ADD CONSTRAINT "WhatsAppThread_instanceId_fkey"
  FOREIGN KEY ("instanceId") REFERENCES "WhatsAppInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- WhatsAppMessage.instanceId: Cascade -> SetNull
ALTER TABLE "WhatsAppMessage" DROP CONSTRAINT "WhatsAppMessage_instanceId_fkey";
ALTER TABLE "WhatsAppMessage" ALTER COLUMN "instanceId" DROP NOT NULL;
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_instanceId_fkey"
  FOREIGN KEY ("instanceId") REFERENCES "WhatsAppInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ownerUserId: preserva pra sempre QUEM era o dono da conversa, independente
-- da instância seguir existindo ou não — sustenta o backup de mensagens em
-- Configurações > Usuários mesmo depois da instância ser apagada.
ALTER TABLE "WhatsAppThread" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "WhatsAppThread" ADD CONSTRAINT "WhatsAppThread_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "WhatsAppThread_organizationId_ownerUserId_idx" ON "WhatsAppThread"("organizationId", "ownerUserId");

-- Backfill: threads existentes ainda têm instância viva agora — grava o
-- dono atual antes que qualquer desativação futura apague a instância.
UPDATE "WhatsAppThread" t
SET "ownerUserId" = i."userId"
FROM "WhatsAppInstance" i
WHERE i.id = t."instanceId" AND t."ownerUserId" IS NULL;
