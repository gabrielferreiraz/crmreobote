-- Cartão Digital — módulo novo (ver plano em
-- C:\Users\Gabriel\.claude\plans\piped-plotting-dahl.md). Extraído à mão do
-- output de `prisma migrate diff` (que comparou o banco real contra o
-- schema.prisma inteiro, incluindo mudanças de OUTRAS sessões em paralelo
-- ainda não migradas — CreateEnum ProcessTemplateTarget, RenameIndex de
-- ProductivityTipDismissal, e um DROP INDEX dos 8 índices trigram
-- recriados na migration anterior (20260914120000) — nenhuma dessas 3
-- coisas pertence a esta migration, ficaram de fora de propósito).

-- CreateEnum
CREATE TYPE "DigitalCardLinkType" AS ENUM ('INSTAGRAM', 'LINKEDIN', 'WEBSITE', 'FACEBOOK', 'YOUTUBE', 'OTHER');

-- CreateEnum
CREATE TYPE "DigitalCardEventType" AS ENUM ('CARD_VIEW', 'QR_PRESENTED', 'CLIENT_ACCESSED', 'CLIENT_REFUSED', 'WHATSAPP_CLICK', 'PHONE_CLICK', 'EMAIL_CLICK', 'MAP_CLICK', 'INSTAGRAM_CLICK', 'LINKEDIN_CLICK', 'LINK_CLICK', 'VCARD_DOWNLOAD', 'SHARE_CLICK');

-- CreateEnum
CREATE TYPE "PresentationResponse" AS ENUM ('ACCESSED', 'REFUSED', 'SELF_VIEW', 'PENDING');

-- CreateTable
CREATE TABLE "DigitalCard" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "jobTitle" TEXT,
    "bio" TEXT,
    "companyName" TEXT DEFAULT 'Reobote Consórcios',
    "photoKey" TEXT,
    "emailOverride" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "address" TEXT,
    "showPortfolioValue" BOOLEAN NOT NULL DEFAULT false,
    "portfolioValueDisplay" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigitalCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigitalCardLink" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "type" "DigitalCardLinkType" NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DigitalCardLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigitalCardEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "eventType" "DigitalCardEventType" NOT NULL,
    "sessionId" TEXT,
    "source" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigitalCardEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigitalCardPresentation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "consultantUserId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "consultantResponse" "PresentationResponse" NOT NULL DEFAULT 'PENDING',
    "automaticAccessDetected" BOOLEAN NOT NULL DEFAULT false,
    "visitorSessionId" TEXT,
    "whatsappClicked" BOOLEAN NOT NULL DEFAULT false,
    "vcardDownloaded" BOOLEAN NOT NULL DEFAULT false,
    "instagramClicked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigitalCardPresentation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DigitalCard_userId_key" ON "DigitalCard"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DigitalCard_slug_key" ON "DigitalCard"("slug");

-- CreateIndex
CREATE INDEX "DigitalCard_organizationId_idx" ON "DigitalCard"("organizationId");

-- CreateIndex
CREATE INDEX "DigitalCardLink_cardId_idx" ON "DigitalCardLink"("cardId");

-- CreateIndex
CREATE INDEX "DigitalCardEvent_cardId_eventType_createdAt_idx" ON "DigitalCardEvent"("cardId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "DigitalCardEvent_organizationId_idx" ON "DigitalCardEvent"("organizationId");

-- CreateIndex
CREATE INDEX "DigitalCardPresentation_cardId_createdAt_idx" ON "DigitalCardPresentation"("cardId", "createdAt");

-- CreateIndex
CREATE INDEX "DigitalCardPresentation_consultantUserId_createdAt_idx" ON "DigitalCardPresentation"("consultantUserId", "createdAt");

-- CreateIndex
CREATE INDEX "DigitalCardPresentation_organizationId_idx" ON "DigitalCardPresentation"("organizationId");

-- AddForeignKey
ALTER TABLE "DigitalCard" ADD CONSTRAINT "DigitalCard_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalCard" ADD CONSTRAINT "DigitalCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalCardLink" ADD CONSTRAINT "DigitalCardLink_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "DigitalCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalCardEvent" ADD CONSTRAINT "DigitalCardEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalCardEvent" ADD CONSTRAINT "DigitalCardEvent_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "DigitalCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalCardPresentation" ADD CONSTRAINT "DigitalCardPresentation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalCardPresentation" ADD CONSTRAINT "DigitalCardPresentation_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "DigitalCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalCardPresentation" ADD CONSTRAINT "DigitalCardPresentation_consultantUserId_fkey" FOREIGN KEY ("consultantUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: DigitalCardLink/Event/Presentation usam a policy padrão org-scoped
-- do projeto (USING/WITH CHECK idênticos — WITH CHECK precisa bater com
-- USING, bug já corrigido nesta sessão pra outras tabelas).
ALTER TABLE "DigitalCardLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DigitalCardLink" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DigitalCardLink"
  USING (EXISTS (
    SELECT 1 FROM "DigitalCard" c
    WHERE c.id = "DigitalCardLink"."cardId"
    AND c."organizationId" = current_setting('app.current_organization_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "DigitalCard" c
    WHERE c.id = "DigitalCardLink"."cardId"
    AND c."organizationId" = current_setting('app.current_organization_id', true)
  ));

ALTER TABLE "DigitalCardEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DigitalCardEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DigitalCardEvent"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "DigitalCardPresentation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DigitalCardPresentation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DigitalCardPresentation"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

-- RLS de DigitalCard: bootstrap por slug ALÉM do isolamento normal por
-- organização (ver comentário no model, schema.prisma) — permite achar UMA
-- linha por slug+active ANTES de conhecer organizationId (visitante público
-- sem login), mesmo padrão de TvDisplayLink/ApiKey (ver
-- lib/tenant-context.ts), só que sem hash: slug não é segredo, é feito pra
-- ser compartilhado. WITH CHECK fica só com a condição normal de
-- organização — nunca se ESCREVE um DigitalCard pelo caminho de bootstrap,
-- só se lê (ver getCardRowBySlug em lib/digital-cards/queries.ts).
ALTER TABLE "DigitalCard" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DigitalCard" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DigitalCard"
  USING (
    "organizationId" = current_setting('app.current_organization_id', true)
    OR (slug = current_setting('app.current_card_slug', true) AND active = true)
  )
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
