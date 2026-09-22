-- Uso de funcionalidade por pessoa/dia (ver FeatureUsageDaily no schema e
-- lib/feature-usage/) — somatório diário, não log de evento, pelo mesmo
-- motivo de UserDailyActivity: uma linha por clique seria volume de escrita
-- enorme pra responder uma pergunta que só precisa de totais.
--
-- Escrita à mão (não gerada por `prisma migrate dev`): a shadow database do
-- migrate dev falha numa migração ANTERIOR e não relacionada
-- (20260812090000_tv_dashboard_config_rls, ver comentário lá), então toda
-- migração nova neste repo é escrita e aplicada manualmente — mesma
-- observação de 20260911120000_lead_requests.

-- CreateTable
CREATE TABLE "FeatureUsageDaily" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureUsageDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeatureUsageDaily_organizationId_userId_date_feature_key" ON "FeatureUsageDaily"("organizationId", "userId", "date", "feature");

-- CreateIndex
CREATE INDEX "FeatureUsageDaily_organizationId_date_idx" ON "FeatureUsageDaily"("organizationId", "date");

-- AddForeignKey
ALTER TABLE "FeatureUsageDaily" ADD CONSTRAINT "FeatureUsageDaily_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureUsageDaily" ADD CONSTRAINT "FeatureUsageDaily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: toda tabela com organizationId precisa disso (Prisma não modela RLS,
-- ver 20260911120000_lead_requests pro mesmo padrão) — sem isso a tabela
-- fica sem isolamento no nível do banco, só o `where: organizationId` do
-- código.
ALTER TABLE "FeatureUsageDaily" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeatureUsageDaily" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FeatureUsageDaily"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
