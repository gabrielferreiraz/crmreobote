-- API oficial da Meta (WhatsApp Cloud API) como segunda forma de conexão,
-- convivendo com o Evolution API (QR Code) — nunca o substitui. Aditivo:
-- novo enum, novas colunas nullable, troca do unique composto (inclui
-- provider). Nenhuma policy de RLS muda — o bootstrap por instanceName já
-- existente (ver 20260710153000_whatsapp_instance_bootstrap_policy) cobre o
-- webhook da Meta também, porque a linha META_CLOUD recebe um instanceName
-- sintético ("meta-{phoneNumberId}") só pra reaproveitar esse mecanismo em
-- vez de duplicar a policy de bootstrap.

CREATE TYPE "WhatsAppProvider" AS ENUM ('EVOLUTION', 'META_CLOUD');

ALTER TABLE "WhatsAppInstance" ADD COLUMN "provider" "WhatsAppProvider" NOT NULL DEFAULT 'EVOLUTION';
ALTER TABLE "WhatsAppInstance" ADD COLUMN "metaAccessToken" TEXT;
ALTER TABLE "WhatsAppInstance" ADD COLUMN "metaPhoneNumberId" TEXT;
ALTER TABLE "WhatsAppInstance" ADD COLUMN "metaWabaId" TEXT;
ALTER TABLE "WhatsAppInstance" ADD COLUMN "metaTokenExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "WhatsAppInstance_metaPhoneNumberId_key" ON "WhatsAppInstance"("metaPhoneNumberId");

-- Era @@unique([organizationId, userId]) — agora inclui provider, pra um
-- vendedor poder ter uma linha EVOLUTION e uma META_CLOUD ao mesmo tempo.
DROP INDEX "WhatsAppInstance_organizationId_userId_key";
CREATE UNIQUE INDEX "WhatsAppInstance_organizationId_userId_provider_key" ON "WhatsAppInstance"("organizationId", "userId", "provider");
