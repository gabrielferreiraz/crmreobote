-- TvDashboardConfig existia no schema.prisma e no banco (criado fora do
-- fluxo normal de migração, sem CREATE TABLE registrado no histórico), mas
-- nunca ganhou RLS — era a única tabela com organizationId direto na
-- organização sem a 2ª camada de proteção que todo o resto do app tem (ver
-- lib/prisma.ts). Mesmo padrão de MonthlyGoal/LeadSource/CreditType/JobTitle.
ALTER TABLE "TvDashboardConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TvDashboardConfig" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TvDashboardConfig"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
