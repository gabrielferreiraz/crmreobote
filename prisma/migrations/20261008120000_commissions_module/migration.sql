-- Módulo de Comissões (ver lib/commissions/ e o bloco "Comissões" em
-- schema.prisma): administradoras, regras de comissão, vendas de comissão e
-- lançamentos (parcelas/ajustes), + Deal.administratorId, + a permissão
-- OrganizationUser.canManageCommissions e as configurações em Organization.
--
-- Gerada com `prisma migrate diff` do schema ANTERIOR (HEAD) para o novo —
-- não contra o banco, que traria junto os índices trigram/GIN que o Prisma
-- não modela (ver migration 20261007120000_contact_updated_at) — e com o
-- RLS acrescentado à mão no fim (migrate nunca gera policy).
--
-- Só aditiva: colunas novas são todas nulas ou com default (ADD COLUMN sem
-- reescrever tabela), nenhum dado existente é tocado.

-- CreateEnum
CREATE TYPE "CommissionModality" AS ENUM ('FULL', 'REDUCED');

-- CreateEnum
CREATE TYPE "CommissionBeneficiaryRole" AS ENUM ('SELLER', 'SUPERVISOR', 'MANAGER');

-- CreateEnum
CREATE TYPE "CommissionBase" AS ENUM ('NET', 'GROSS');

-- CreateEnum
CREATE TYPE "CommissionSaleStatus" AS ENUM ('REVIEW', 'ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CommissionSaleSource" AS ENUM ('CRM', 'LEGACY', 'MANUAL');

-- CreateEnum
CREATE TYPE "CommissionEntryKind" AS ENUM ('INSTALLMENT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CommissionEntryStatus" AS ENUM ('SCHEDULED', 'ON_HOLD', 'PAID', 'CANCELLED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "commissionPayDay" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "commissionSellerPastMonths" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "commissionStartDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrganizationUser" ADD COLUMN     "canManageCommissions" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "administratorId" TEXT;

-- CreateTable
CREATE TABLE "ConsortiumAdministrator" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "commissionInstallments" INTEGER NOT NULL DEFAULT 1,
    "installmentPercents" JSONB,
    "graceMonths" INTEGER NOT NULL DEFAULT 1,
    "cutoffDay" INTEGER,
    "paysSellerDirectly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsortiumAdministrator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "beneficiaryRole" "CommissionBeneficiaryRole" NOT NULL DEFAULT 'SELLER',
    "userId" TEXT,
    "administratorId" TEXT,
    "modality" "CommissionModality",
    "creditType" TEXT,
    "base" "CommissionBase" NOT NULL DEFAULT 'NET',
    "percent" DECIMAL(7,4) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionSale" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dealId" TEXT,
    "sourceDealId" TEXT,
    "source" "CommissionSaleSource" NOT NULL DEFAULT 'CRM',
    "status" "CommissionSaleStatus" NOT NULL DEFAULT 'ACTIVE',
    "autoCancelled" BOOLEAN NOT NULL DEFAULT false,
    "clientName" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "supervisorId" TEXT,
    "managerId" TEXT,
    "administratorId" TEXT,
    "modality" "CommissionModality" NOT NULL DEFAULT 'FULL',
    "creditType" TEXT,
    "saleDate" TIMESTAMP(3) NOT NULL,
    "netValue" DECIMAL(12,2),
    "grossValue" DECIMAL(12,2),
    "quotaNumber" TEXT,
    "groupNumber" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "saleId" TEXT,
    "beneficiaryId" TEXT NOT NULL,
    "role" "CommissionBeneficiaryRole" NOT NULL DEFAULT 'SELLER',
    "kind" "CommissionEntryKind" NOT NULL DEFAULT 'INSTALLMENT',
    "installmentNumber" INTEGER,
    "installmentCount" INTEGER,
    "paymentMonth" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "percent" DECIMAL(7,4),
    "ruleId" TEXT,
    "status" "CommissionEntryStatus" NOT NULL DEFAULT 'SCHEDULED',
    "paidByAdministrator" BOOLEAN NOT NULL DEFAULT false,
    "holdReason" TEXT,
    "note" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsortiumAdministrator_organizationId_idx" ON "ConsortiumAdministrator"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsortiumAdministrator_organizationId_name_key" ON "ConsortiumAdministrator"("organizationId", "name");

-- CreateIndex
CREATE INDEX "CommissionRule_organizationId_active_idx" ON "CommissionRule"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionSale_dealId_key" ON "CommissionSale"("dealId");

-- CreateIndex
CREATE INDEX "CommissionSale_organizationId_status_idx" ON "CommissionSale"("organizationId", "status");

-- CreateIndex
CREATE INDEX "CommissionSale_organizationId_sellerId_idx" ON "CommissionSale"("organizationId", "sellerId");

-- CreateIndex
CREATE INDEX "CommissionSale_organizationId_saleDate_idx" ON "CommissionSale"("organizationId", "saleDate");

-- CreateIndex
CREATE INDEX "CommissionSale_organizationId_sourceDealId_idx" ON "CommissionSale"("organizationId", "sourceDealId");

-- CreateIndex
CREATE INDEX "CommissionEntry_organizationId_paymentMonth_idx" ON "CommissionEntry"("organizationId", "paymentMonth");

-- CreateIndex
CREATE INDEX "CommissionEntry_organizationId_beneficiaryId_paymentMonth_idx" ON "CommissionEntry"("organizationId", "beneficiaryId", "paymentMonth");

-- CreateIndex
CREATE INDEX "CommissionEntry_saleId_idx" ON "CommissionEntry"("saleId");

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_administratorId_fkey" FOREIGN KEY ("administratorId") REFERENCES "ConsortiumAdministrator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsortiumAdministrator" ADD CONSTRAINT "ConsortiumAdministrator_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_administratorId_fkey" FOREIGN KEY ("administratorId") REFERENCES "ConsortiumAdministrator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionSale" ADD CONSTRAINT "CommissionSale_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionSale" ADD CONSTRAINT "CommissionSale_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionSale" ADD CONSTRAINT "CommissionSale_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionSale" ADD CONSTRAINT "CommissionSale_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionSale" ADD CONSTRAINT "CommissionSale_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionSale" ADD CONSTRAINT "CommissionSale_administratorId_fkey" FOREIGN KEY ("administratorId") REFERENCES "ConsortiumAdministrator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "CommissionSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CommissionRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- RLS: mesmo tenant_isolation de toda tabela com organizationId.
ALTER TABLE "ConsortiumAdministrator" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsortiumAdministrator" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ConsortiumAdministrator"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "CommissionRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionRule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CommissionRule"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "CommissionSale" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionSale" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CommissionSale"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "CommissionEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CommissionEntry"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
