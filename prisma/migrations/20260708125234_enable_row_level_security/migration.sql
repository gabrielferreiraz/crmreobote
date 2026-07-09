-- Row Level Security (RLS) multi-tenant — segunda camada de proteção além do
-- `where: { organizationId }` em cada query do Prisma (ver lib/prisma.ts e
-- lib/tenant-context.ts). Um esquecimento de `where` numa rota não vaza mais
-- dados entre organizações: o Postgres filtra na origem.
--
-- IMPORTANTE: isso só tem efeito real porque a aplicação conecta como o role
-- "app_runtime" (sem BYPASSRLS, sem superusuário — ver script que o criou).
-- Rodando como "postgres" (superusuário), RLS é sempre ignorado.
--
-- Padrão: cada tabela com "organizationId" próprio é restrita por
-- `current_setting('app.current_organization_id', true)`. "OrganizationUser"
-- tem uma regra extra (também permite ver a própria filiação por userId), pro
-- login conseguir descobrir a organização do usuário antes de sabê-la.
-- "PipelineStage" e "AutomationExecution" não têm organizationId próprio e são
-- restritas via subquery na tabela pai.

-- ─── OrganizationUser ────────────────────────────────────────────────
ALTER TABLE "OrganizationUser" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrganizationUser" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OrganizationUser"
  USING (
    "organizationId" = current_setting('app.current_organization_id', true)
    OR "userId" = current_setting('app.current_user_id', true)
  )
  WITH CHECK (
    "organizationId" = current_setting('app.current_organization_id', true)
    OR "userId" = current_setting('app.current_user_id', true)
  );

-- ─── Tabelas com organizationId próprio ──────────────────────────────
ALTER TABLE "Team" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Team" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Team"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "Pipeline" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Pipeline" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Pipeline"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Contact"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "LossReason" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LossReason" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LossReason"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "Deal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Deal" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Deal"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Task" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Task"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "Activity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Activity" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Activity"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "AutomationRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutomationRule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AutomationRule"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

-- ─── Tabelas restritas via tabela pai (sem organizationId próprio) ───
ALTER TABLE "PipelineStage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PipelineStage" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PipelineStage"
  USING (EXISTS (
    SELECT 1 FROM "Pipeline" p
    WHERE p.id = "PipelineStage"."pipelineId"
    AND p."organizationId" = current_setting('app.current_organization_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Pipeline" p
    WHERE p.id = "PipelineStage"."pipelineId"
    AND p."organizationId" = current_setting('app.current_organization_id', true)
  ));

ALTER TABLE "AutomationExecution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutomationExecution" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AutomationExecution"
  USING (EXISTS (
    SELECT 1 FROM "AutomationRule" r
    WHERE r.id = "AutomationExecution"."ruleId"
    AND r."organizationId" = current_setting('app.current_organization_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "AutomationRule" r
    WHERE r.id = "AutomationExecution"."ruleId"
    AND r."organizationId" = current_setting('app.current_organization_id', true)
  ));
