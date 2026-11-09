-- Pedidos de documento/correção do administrativo ao consultor (pós-Ganho).
-- Migration aditiva: 1 enum + 1 tabela nova, com isolamento por organização.

CREATE TYPE "DealDocumentRequestStatus" AS ENUM ('OPEN', 'FULFILLED', 'CANCELLED');

CREATE TABLE "DealDocumentRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "message" TEXT,
    "status" "DealDocumentRequestStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealDocumentRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DealDocumentRequest_organizationId_status_idx" ON "DealDocumentRequest"("organizationId", "status");
CREATE INDEX "DealDocumentRequest_dealId_status_idx" ON "DealDocumentRequest"("dealId", "status");

ALTER TABLE "DealDocumentRequest" ADD CONSTRAINT "DealDocumentRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DealDocumentRequest" ADD CONSTRAINT "DealDocumentRequest_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DealDocumentRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DealDocumentRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DealDocumentRequest"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
