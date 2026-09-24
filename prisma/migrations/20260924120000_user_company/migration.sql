-- Empresa (PJ) do consultor — ver UserCompany no schema. Alimenta o nome
-- estampado no Ranking do mês da TV: quem tem PJ cadastrada aparece com o
-- nome da empresa no lugar do nome pessoal (ver rankingRaw em
-- lib/tv-dashboard.ts).
--
-- Escrita à mão (não gerada por `prisma migrate dev`): a shadow database do
-- migrate dev falha numa migração ANTERIOR e não relacionada
-- (20260812090000_tv_dashboard_config_rls, ver comentário lá), então toda
-- migração nova neste repo é escrita e aplicada manualmente — mesma
-- observação de 20260921210000_feature_usage_daily.

-- CreateTable
CREATE TABLE "UserCompany" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCompany_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserCompany_userId_key" ON "UserCompany"("userId");

-- CreateIndex
CREATE INDEX "UserCompany_organizationId_idx" ON "UserCompany"("organizationId");

-- AddForeignKey
ALTER TABLE "UserCompany" ADD CONSTRAINT "UserCompany_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCompany" ADD CONSTRAINT "UserCompany_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: toda tabela com organizationId precisa disso (Prisma não modela RLS,
-- ver 20260911120000_lead_requests pro mesmo padrão) — sem isso a tabela
-- fica sem isolamento no nível do banco, só o `where: organizationId` do
-- código.
ALTER TABLE "UserCompany" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserCompany" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "UserCompany"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
