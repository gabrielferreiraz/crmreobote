-- Módulo de Processos (pós-venda) — "CRM dentro do CRM" separado do
-- Deal/Pipeline de vendas de propósito (zero risco pro funil de vendas já
-- em produção). Aditivo: só tabelas novas + uma coluna nova em
-- OrganizationUser. Backfill de dados (pipeline padrão por organização +
-- processo pra negócio já ganho) roda à parte via script (ver
-- scripts/backfill-process-pipelines.ts), não nesta migração — mais seguro
-- que duplicar a lógica de geração de id/relacionamento em SQL puro.

CREATE TYPE "DocumentStatus" AS ENUM ('NOT_REQUESTED', 'PENDING_DELIVERY', 'DELIVERED');

ALTER TABLE "OrganizationUser" ADD COLUMN "canManageProcesses" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ProcessPipeline" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessPipeline_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProcessPipeline_organizationId_idx" ON "ProcessPipeline"("organizationId");
ALTER TABLE "ProcessPipeline" ADD CONSTRAINT "ProcessPipeline_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProcessStage" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "color" TEXT,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessStage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProcessStage_pipelineId_idx" ON "ProcessStage"("pipelineId");
ALTER TABLE "ProcessStage" ADD CONSTRAINT "ProcessStage_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "ProcessPipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Process" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "contemplated" BOOLEAN NOT NULL DEFAULT false,
    "paymentPending" BOOLEAN NOT NULL DEFAULT true,
    "documentStatus" "DocumentStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
    "stageEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Process_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Process_dealId_key" ON "Process"("dealId");
CREATE INDEX "Process_organizationId_idx" ON "Process"("organizationId");
CREATE INDEX "Process_organizationId_ownerId_idx" ON "Process"("organizationId", "ownerId");
CREATE INDEX "Process_organizationId_stageId_idx" ON "Process"("organizationId", "stageId");
CREATE INDEX "Process_organizationId_pipelineId_idx" ON "Process"("organizationId", "pipelineId");

ALTER TABLE "Process" ADD CONSTRAINT "Process_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Process" ADD CONSTRAINT "Process_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "ProcessPipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Process" ADD CONSTRAINT "Process_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "ProcessStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Process" ADD CONSTRAINT "Process_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Process" ADD CONSTRAINT "Process_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Process" ADD CONSTRAINT "Process_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProcessStageHistory" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromStageId" TEXT,
    "toStageId" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessStageHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProcessStageHistory_processId_idx" ON "ProcessStageHistory"("processId");
CREATE INDEX "ProcessStageHistory_organizationId_idx" ON "ProcessStageHistory"("organizationId");

ALTER TABLE "ProcessStageHistory" ADD CONSTRAINT "ProcessStageHistory_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcessStageHistory" ADD CONSTRAINT "ProcessStageHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcessStageHistory" ADD CONSTRAINT "ProcessStageHistory_toStageId_fkey" FOREIGN KEY ("toStageId") REFERENCES "ProcessStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcessStageHistory" ADD CONSTRAINT "ProcessStageHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProcessRequest" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProcessRequest_organizationId_resolvedAt_idx" ON "ProcessRequest"("organizationId", "resolvedAt");
CREATE INDEX "ProcessRequest_processId_idx" ON "ProcessRequest"("processId");

ALTER TABLE "ProcessRequest" ADD CONSTRAINT "ProcessRequest_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcessRequest" ADD CONSTRAINT "ProcessRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcessRequest" ADD CONSTRAINT "ProcessRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcessRequest" ADD CONSTRAINT "ProcessRequest_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: mesmo padrão tenant_isolation de toda tabela nova org-scoped (ver
-- 20260717090000_api_integrations) — sem bootstrap (nenhuma dessas tabelas é
-- lida antes de saber o organizationId; só rotas autenticadas de sessão).
ALTER TABLE "ProcessPipeline" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProcessPipeline" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProcessPipeline"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "Process" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Process" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Process"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "ProcessStageHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProcessStageHistory" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProcessStageHistory"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "ProcessRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProcessRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProcessRequest"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

-- ProcessStage não tem organizationId direto (segue o mesmo desenho do
-- PipelineStage de vendas, que também não tem) — isolamento vem do
-- pipelineId, que por sua vez já é filtrado por organizationId no
-- ProcessPipeline. Ainda assim habilita RLS pra nunca ficar de fora por
-- descuido; a policy verifica via subquery na própria ProcessPipeline.
ALTER TABLE "ProcessStage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProcessStage" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProcessStage"
  USING (
    EXISTS (
      SELECT 1 FROM "ProcessPipeline" pp
      WHERE pp."id" = "ProcessStage"."pipelineId"
        AND pp."organizationId" = current_setting('app.current_organization_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "ProcessPipeline" pp
      WHERE pp."id" = "ProcessStage"."pipelineId"
        AND pp."organizationId" = current_setting('app.current_organization_id', true)
    )
  );
