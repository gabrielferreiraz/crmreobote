-- Modelos de solicitação (documentação/petição) que o administrativo de
-- Processos manda pro consultor ou direto pro cliente — ver "Enviar
-- modelo" em process-detail.tsx.

-- ProcessRequest passa a ser de mão dupla: targetUserId (novo, opcional)
-- marca uma solicitação criada PELO administrativo, endereçada a um
-- consultor específico (quem resolve é ele, não mais só o admin).
ALTER TABLE "ProcessRequest" ADD COLUMN "targetUserId" TEXT;
ALTER TABLE "ProcessRequest" ADD CONSTRAINT "ProcessRequest_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ProcessTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProcessTemplateUsage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "usedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessTemplateUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProcessTemplate_organizationId_idx" ON "ProcessTemplate"("organizationId");
CREATE INDEX "ProcessTemplateUsage_organizationId_idx" ON "ProcessTemplateUsage"("organizationId");
CREATE INDEX "ProcessTemplateUsage_templateId_stageId_idx" ON "ProcessTemplateUsage"("templateId", "stageId");
CREATE INDEX "ProcessTemplateUsage_processId_templateId_idx" ON "ProcessTemplateUsage"("processId", "templateId");

ALTER TABLE "ProcessTemplate" ADD CONSTRAINT "ProcessTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcessTemplate" ADD CONSTRAINT "ProcessTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProcessTemplateUsage" ADD CONSTRAINT "ProcessTemplateUsage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcessTemplateUsage" ADD CONSTRAINT "ProcessTemplateUsage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProcessTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcessTemplateUsage" ADD CONSTRAINT "ProcessTemplateUsage_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcessTemplateUsage" ADD CONSTRAINT "ProcessTemplateUsage_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "ProcessStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcessTemplateUsage" ADD CONSTRAINT "ProcessTemplateUsage_usedById_fkey" FOREIGN KEY ("usedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS — mesmo padrão de ProcessRequest (organizationId direto).
ALTER TABLE "ProcessTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProcessTemplate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProcessTemplate"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "ProcessTemplateUsage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProcessTemplateUsage" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProcessTemplateUsage"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
