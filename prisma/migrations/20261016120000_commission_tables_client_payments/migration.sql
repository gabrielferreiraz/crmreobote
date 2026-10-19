-- Comissões por CATEGORIA, "o cliente pagou a parcela?" e parcelas sem
-- comissão (ver CommissionTable, CommissionClientPayment e
-- CommissionUnpaidPolicy em schema.prisma):
--  - "em quantas vezes" e "quanto paga pra corretora" saem da administradora
--    e vão pra tabelas (uma padrão + uma por categoria, quando muda);
--  - cada tabela marca as parcelas sem comissão (skippedInstallments);
--  - o ✓ mensal de "cliente pagou" por venda, débito automático na venda,
--    e a regra de cada administradora pra quando o cliente não paga.
-- Escrita à mão (sem os índices trigram que o diff contra o banco traria).

-- CreateEnum
CREATE TYPE "CommissionUnpaidPolicy" AS ENUM ('IGNORE', 'HOLD', 'FORFEIT', 'DEFER');

-- AlterTable
ALTER TABLE "CommissionEntry" ADD COLUMN "clientPaymentEffect" "CommissionUnpaidPolicy",
ADD COLUMN "deferredFromMonth" TEXT;

-- AlterTable
ALTER TABLE "CommissionSale" ADD COLUMN "autoDebit" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ConsortiumAdministrator" ADD COLUMN "unpaidPolicy" "CommissionUnpaidPolicy" NOT NULL DEFAULT 'HOLD';

-- CreateTable
CREATE TABLE "CommissionTable" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "administratorId" TEXT NOT NULL,
    "creditType" TEXT,
    "commissionInstallments" INTEGER NOT NULL DEFAULT 1,
    "skippedInstallments" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "revenueMode" "CommissionRevenueMode",
    "revenueTotalPercent" DECIMAL(7,4),
    "revenuePercents" JSONB,
    "revenueBase" "CommissionBase" NOT NULL DEFAULT 'NET',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionClientPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "paid" BOOLEAN NOT NULL,
    "markedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionClientPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommissionTable_organizationId_idx" ON "CommissionTable"("organizationId");
CREATE INDEX "CommissionTable_administratorId_idx" ON "CommissionTable"("administratorId");
CREATE INDEX "CommissionClientPayment_organizationId_month_idx" ON "CommissionClientPayment"("organizationId", "month");
CREATE UNIQUE INDEX "CommissionClientPayment_saleId_month_key" ON "CommissionClientPayment"("saleId", "month");

-- AddForeignKey
ALTER TABLE "CommissionTable" ADD CONSTRAINT "CommissionTable_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionTable" ADD CONSTRAINT "CommissionTable_administratorId_fkey" FOREIGN KEY ("administratorId") REFERENCES "ConsortiumAdministrator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionClientPayment" ADD CONSTRAINT "CommissionClientPayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionClientPayment" ADD CONSTRAINT "CommissionClientPayment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "CommissionSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Leva o que cada administradora já tinha cadastrado pra tabela PADRÃO dela
-- (em 16/10/2026 não havia nenhuma — módulo em montagem — mas a migração
-- não pode depender disso).
INSERT INTO "CommissionTable" ("id", "organizationId", "administratorId", "creditType", "commissionInstallments",
                               "revenueMode", "revenueTotalPercent", "revenuePercents", "revenueBase", "updatedAt")
SELECT 'tbl_' || md5(a."id"), a."organizationId", a."id", NULL, a."commissionInstallments",
       a."revenueMode", a."revenueTotalPercent", a."revenuePercents", a."revenueBase", CURRENT_TIMESTAMP
  FROM "ConsortiumAdministrator" a;

-- AlterTable (agora que o conteúdo foi copiado)
ALTER TABLE "ConsortiumAdministrator" DROP COLUMN "commissionInstallments",
DROP COLUMN "revenueBase",
DROP COLUMN "revenueMode",
DROP COLUMN "revenuePercents",
DROP COLUMN "revenueTotalPercent";

-- RLS: mesmo tenant_isolation de toda tabela com organizationId.
ALTER TABLE "CommissionTable" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionTable" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CommissionTable"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "CommissionClientPayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionClientPayment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CommissionClientPayment"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
