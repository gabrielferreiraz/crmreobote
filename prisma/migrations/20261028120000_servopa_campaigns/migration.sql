-- Campanhas das tabelas Servopa (Black November, "12 do 12"…): arte de fundo
-- na faixa do cabeçalho do PDF, com período programado. As imagens ficam no R2;
-- o banco guarda só as chaves. Migration aditiva: cria somente este enum e esta tabela.

CREATE TYPE "ServopaCampaignTextColor" AS ENUM ('WHITE', 'BLACK');

CREATE TABLE "ServopaCampaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsOn" DATE,
    "endsOn" DATE,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "textColor" "ServopaCampaignTextColor" NOT NULL DEFAULT 'WHITE',
    "artKey" TEXT,
    "realEstateArtKey" TEXT,
    "movableArtKey" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServopaCampaign_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServopaCampaign_organizationId_enabled_idx" ON "ServopaCampaign"("organizationId", "enabled");

ALTER TABLE "ServopaCampaign" ADD CONSTRAINT "ServopaCampaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServopaCampaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServopaCampaign" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "ServopaCampaign"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
