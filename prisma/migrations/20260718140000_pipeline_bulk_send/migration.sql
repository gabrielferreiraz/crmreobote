-- Envio de mensagem em massa a partir do Pipeline (Lista) — modelado como
-- uma nova origem de Campaign (CampaignSource.PIPELINE_BULK) em vez de um
-- sistema paralelo, pra reaproveitar toda a engine de disparo/relatórios já
-- existente. Puramente aditivo: nenhuma policy de RLS muda (CampaignRecipient
-- não tem organizationId próprio, RLS é via subquery na Campaign pai, que
-- não depende de nenhuma coluna nova aqui).

CREATE TYPE "CampaignSource" AS ENUM ('MANUAL', 'PIPELINE_BULK');

ALTER TABLE "Campaign" ADD COLUMN "source" "CampaignSource" NOT NULL DEFAULT 'MANUAL';

-- dealId: rastreia de qual negócio esse destinatário veio (só PIPELINE_BULK).
-- instanceId: de qual WhatsApp ESTE destinatário deve ser enviado — um envio
-- em massa do Pipeline pode juntar negócios de vários consultores diferentes
-- na mesma campanha, cada um com seu próprio número conectado. null (o caso
-- de sempre, campanhas MANUAL) = usa a instanceId única da Campaign, sem
-- nenhuma mudança de comportamento pro que já existe.
ALTER TABLE "CampaignRecipient" ADD COLUMN "dealId" TEXT;
ALTER TABLE "CampaignRecipient" ADD COLUMN "instanceId" TEXT;

CREATE INDEX "CampaignRecipient_dealId_idx" ON "CampaignRecipient"("dealId");
CREATE INDEX "CampaignRecipient_instanceId_idx" ON "CampaignRecipient"("instanceId");

ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WhatsAppInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
