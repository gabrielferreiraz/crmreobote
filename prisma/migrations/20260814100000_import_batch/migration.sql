-- Rastro de auditoria de importação de planilha (negócios hoje, ver
-- app/api/deals/import/route.ts — outros tipos podem reaproveitar mais
-- pra frente, ver comentário do campo "type" no schema). Guarda só
-- metadados (quem, quando, arquivo, contagens); os dados em si já viraram
-- Contact/Deal de verdade, marcados com importBatchId.
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowsTotal" INTEGER NOT NULL,
    "rowsCreated" INTEGER NOT NULL,
    "rowsSkipped" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportBatch_organizationId_createdAt_idx" ON "ImportBatch"("organizationId", "createdAt");

ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS — mesmo padrão de AuditLog (ver 20260728120000_api_key_expiry_and_audit_log)
ALTER TABLE "ImportBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImportBatch" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ImportBatch"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

-- Deal/Contact: de qual lote vieram (null = criado manualmente/por API/
-- webhook — não passou por importação nenhuma). SET NULL no delete: apagar
-- um ImportBatch (não fazemos isso hoje, mas por via das dúvidas) nunca
-- deve apagar negócio/contato real junto.
ALTER TABLE "Deal" ADD COLUMN "importBatchId" TEXT;
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Deal_organizationId_importBatchId_idx" ON "Deal"("organizationId", "importBatchId");

ALTER TABLE "Contact" ADD COLUMN "importBatchId" TEXT;
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Contact_organizationId_importBatchId_idx" ON "Contact"("organizationId", "importBatchId");
