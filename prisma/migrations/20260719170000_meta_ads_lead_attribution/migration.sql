-- Integração Meta Ads: Lead Ads (formulário nativo -> Contact/Deal
-- automático) + Conversions API (avisa a Meta quando um negócio vira ganho)
-- + atribuição pra relatório de conversão por campanha.

-- CreateTable: MetaAdsConnection — uma por organização (Lead Ads pertence a
-- uma Página, que representa o negócio, não um vendedor).
CREATE TABLE "MetaAdsConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "pageName" TEXT NOT NULL,
    "pageAccessTokenEncrypted" TEXT NOT NULL,
    "pixelId" TEXT,
    "connectedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaAdsConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetaAdsConnection_organizationId_key" ON "MetaAdsConnection"("organizationId");
CREATE UNIQUE INDEX "MetaAdsConnection_pageId_key" ON "MetaAdsConnection"("pageId");

ALTER TABLE "MetaAdsConnection" ADD CONSTRAINT "MetaAdsConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MetaAdsConnection" ADD CONSTRAINT "MetaAdsConnection_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MetaAdsConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MetaAdsConnection" FORCE ROW LEVEL SECURITY;
-- Bootstrap policy (mesmo padrão de WhatsAppInstance/ApiKey): o webhook de
-- Lead Ads só conhece o pageId, não o organizationId, ainda.
CREATE POLICY tenant_isolation ON "MetaAdsConnection"
  USING (
    "organizationId" = current_setting('app.current_organization_id', true)
    OR "pageId" = current_setting('app.current_meta_page_id', true)
  )
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

-- AlterTable: Contact — atribuição de Lead Ads (preenchido só quando o
-- contato chegou via formulário nativo de anúncio).
ALTER TABLE "Contact" ADD COLUMN "metaLeadgenId" TEXT;
ALTER TABLE "Contact" ADD COLUMN "metaAdId" TEXT;
ALTER TABLE "Contact" ADD COLUMN "metaAdSetId" TEXT;
ALTER TABLE "Contact" ADD COLUMN "metaCampaignId" TEXT;
ALTER TABLE "Contact" ADD COLUMN "metaCampaignName" TEXT;
ALTER TABLE "Contact" ADD COLUMN "metaFormId" TEXT;

CREATE UNIQUE INDEX "Contact_metaLeadgenId_key" ON "Contact"("metaLeadgenId");
CREATE INDEX "Contact_organizationId_metaCampaignId_idx" ON "Contact"("organizationId", "metaCampaignId");
