-- Divisão do negócio entre consultores (co-responsáveis) e da comissão.
--
-- Só ADITIVA: duas tabelas novas. Nenhuma coluna de tabela existente muda
-- (de propósito: uma coluna nova em CommissionSale/Deal faria TODA consulta a
-- elas falhar até a migração ser aplicada). O código só lê estas tabelas com
-- DEAL_SPLIT_ENABLED=true.
--
-- Escrita à mão (sem os índices trigram que o diff contra o banco traria).

-- CreateTable
CREATE TABLE "DealParticipant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sharePercent" INTEGER NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealParticipant_pkey" PRIMARY KEY ("id"),
    -- 1–99: o responsável principal fica com o que sobra (nunca zero).
    CONSTRAINT "DealParticipant_sharePercent_check" CHECK ("sharePercent" BETWEEN 1 AND 99)
);

-- CreateTable
CREATE TABLE "CommissionSaleShare" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "percent" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionSaleShare_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CommissionSaleShare_percent_check" CHECK ("percent" BETWEEN 1 AND 100)
);

-- CreateIndex
CREATE UNIQUE INDEX "DealParticipant_dealId_userId_key" ON "DealParticipant"("dealId", "userId");

-- CreateIndex
CREATE INDEX "DealParticipant_organizationId_userId_idx" ON "DealParticipant"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionSaleShare_saleId_userId_key" ON "CommissionSaleShare"("saleId", "userId");

-- CreateIndex
CREATE INDEX "CommissionSaleShare_organizationId_userId_idx" ON "CommissionSaleShare"("organizationId", "userId");

-- AddForeignKey
ALTER TABLE "DealParticipant" ADD CONSTRAINT "DealParticipant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealParticipant" ADD CONSTRAINT "DealParticipant_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealParticipant" ADD CONSTRAINT "DealParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealParticipant" ADD CONSTRAINT "DealParticipant_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionSaleShare" ADD CONSTRAINT "CommissionSaleShare_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionSaleShare" ADD CONSTRAINT "CommissionSaleShare_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "CommissionSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionSaleShare" ADD CONSTRAINT "CommissionSaleShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: mesmo tenant_isolation de toda tabela com organizationId.
ALTER TABLE "DealParticipant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DealParticipant" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DealParticipant"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "CommissionSaleShare" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionSaleShare" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CommissionSaleShare"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
