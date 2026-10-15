-- Quanto a CORRETORA recebe da administradora (ver ConsortiumAdministrator.
-- revenueMode e o model CommissionRevenue em schema.prisma): cada
-- administradora paga de um jeito (% do crédito em partes iguais, tabela de
-- % do crédito por parcela, ou % da parcela que o cliente paga) e o
-- consultor pode ganhar "% do que a corretora recebe" (CommissionBase
-- COMPANY_REVENUE).
--
-- Substitui ConsortiumAdministrator.installmentPercents (divisão da comissão
-- do consultor em fatias que somavam 100%) — a parcela do consultor agora
-- acompanha o ritmo da tabela da administradora. Coluna removida sem
-- conversão: confirmado no banco em 14/10/2026 que nenhuma administradora
-- estava cadastrada ainda (módulo em montagem).
--
-- Escrita à mão (sem os índices trigram que o diff contra o banco traria).

-- CreateEnum
CREATE TYPE "CommissionRevenueMode" AS ENUM ('CREDIT_EQUAL', 'CREDIT_TABLE', 'CLIENT_INSTALLMENT_TABLE');

-- CreateEnum
CREATE TYPE "CommissionRevenueStatus" AS ENUM ('EXPECTED', 'RECEIVED');

-- AlterEnum (o valor novo não é usado nesta migração)
ALTER TYPE "CommissionBase" ADD VALUE IF NOT EXISTS 'COMPANY_REVENUE';

-- AlterTable
ALTER TABLE "CommissionSale" ADD COLUMN "clientInstallment" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "ConsortiumAdministrator" DROP COLUMN "installmentPercents",
ADD COLUMN "revenueBase" "CommissionBase" NOT NULL DEFAULT 'NET',
ADD COLUMN "revenueMode" "CommissionRevenueMode",
ADD COLUMN "revenuePercents" JSONB,
ADD COLUMN "revenueTotalPercent" DECIMAL(7,4);

-- CreateTable
CREATE TABLE "CommissionRevenue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "installmentNumber" INTEGER NOT NULL,
    "installmentCount" INTEGER NOT NULL,
    "paymentMonth" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "percent" DECIMAL(7,4),
    "status" "CommissionRevenueStatus" NOT NULL DEFAULT 'EXPECTED',
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionRevenue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommissionRevenue_organizationId_paymentMonth_idx" ON "CommissionRevenue"("organizationId", "paymentMonth");

-- CreateIndex
CREATE INDEX "CommissionRevenue_saleId_idx" ON "CommissionRevenue"("saleId");

-- AddForeignKey
ALTER TABLE "CommissionRevenue" ADD CONSTRAINT "CommissionRevenue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRevenue" ADD CONSTRAINT "CommissionRevenue_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "CommissionSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: mesmo tenant_isolation de toda tabela com organizationId.
ALTER TABLE "CommissionRevenue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionRevenue" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CommissionRevenue"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
