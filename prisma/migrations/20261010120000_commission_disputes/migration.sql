-- Contestação de parcela de comissão ("Esse valor está errado?") — ver o
-- model CommissionDispute em schema.prisma. Escrita à mão (mesmo motivo da
-- 20261008120000_commissions_module: diff contra o banco traria os índices
-- trigram que o Prisma não modela). Só aditiva: tabela nova + enum novo.

-- CreateEnum
CREATE TYPE "CommissionDisputeStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "CommissionDispute" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "CommissionDisputeStatus" NOT NULL DEFAULT 'OPEN',
    "response" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionDispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommissionDispute_organizationId_status_idx" ON "CommissionDispute"("organizationId", "status");

-- CreateIndex
CREATE INDEX "CommissionDispute_entryId_idx" ON "CommissionDispute"("entryId");

-- AddForeignKey
ALTER TABLE "CommissionDispute" ADD CONSTRAINT "CommissionDispute_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionDispute" ADD CONSTRAINT "CommissionDispute_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "CommissionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionDispute" ADD CONSTRAINT "CommissionDispute_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionDispute" ADD CONSTRAINT "CommissionDispute_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS: mesmo tenant_isolation de toda tabela com organizationId.
ALTER TABLE "CommissionDispute" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionDispute" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CommissionDispute"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
