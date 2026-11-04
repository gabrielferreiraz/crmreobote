-- Bônus por meta batida (ver CommissionIndividualGoal/CommissionBonusRule/
-- CommissionBonusTier/CommissionBonusAward em schema.prisma) — escrita à mão
-- (mesmo motivo de toda migration de Comissões: só aditiva, tabelas/enum
-- novos, sem tocar em nada existente).

-- CreateEnum
CREATE TYPE "CommissionBonusRewardType" AS ENUM ('FIXED', 'PERCENT');

-- CreateTable
CREATE TABLE "CommissionIndividualGoal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "CommissionIndividualGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionBonusRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "beneficiaryRole" "CommissionBeneficiaryRole" NOT NULL DEFAULT 'SELLER',
    "userId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionBonusRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionBonusTier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "thresholdPercent" DECIMAL(6,2) NOT NULL,
    "rewardType" "CommissionBonusRewardType" NOT NULL,
    "rewardValue" DECIMAL(12,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionBonusTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionBonusAward" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "beneficiaryId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "achievedPercent" DECIMAL(6,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "entryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionBonusAward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommissionIndividualGoal_organizationId_userId_year_month_key" ON "CommissionIndividualGoal"("organizationId", "userId", "year", "month");

-- CreateIndex
CREATE INDEX "CommissionIndividualGoal_organizationId_year_month_idx" ON "CommissionIndividualGoal"("organizationId", "year", "month");

-- CreateIndex
CREATE INDEX "CommissionBonusRule_organizationId_active_idx" ON "CommissionBonusRule"("organizationId", "active");

-- CreateIndex
CREATE INDEX "CommissionBonusTier_ruleId_idx" ON "CommissionBonusTier"("ruleId");

-- CreateIndex
CREATE INDEX "CommissionBonusTier_organizationId_idx" ON "CommissionBonusTier"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionBonusAward_entryId_key" ON "CommissionBonusAward"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionBonusAward_ruleId_beneficiaryId_month_key" ON "CommissionBonusAward"("ruleId", "beneficiaryId", "month");

-- CreateIndex
CREATE INDEX "CommissionBonusAward_organizationId_month_idx" ON "CommissionBonusAward"("organizationId", "month");

-- AddForeignKey
ALTER TABLE "CommissionIndividualGoal" ADD CONSTRAINT "CommissionIndividualGoal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionIndividualGoal" ADD CONSTRAINT "CommissionIndividualGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionIndividualGoal" ADD CONSTRAINT "CommissionIndividualGoal_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionBonusRule" ADD CONSTRAINT "CommissionBonusRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionBonusRule" ADD CONSTRAINT "CommissionBonusRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionBonusTier" ADD CONSTRAINT "CommissionBonusTier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionBonusTier" ADD CONSTRAINT "CommissionBonusTier_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CommissionBonusRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionBonusAward" ADD CONSTRAINT "CommissionBonusAward_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionBonusAward" ADD CONSTRAINT "CommissionBonusAward_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CommissionBonusRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionBonusAward" ADD CONSTRAINT "CommissionBonusAward_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionBonusAward" ADD CONSTRAINT "CommissionBonusAward_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "CommissionEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS: mesmo tenant_isolation de toda tabela com organizationId — inclusive
-- CommissionBonusTier, que é "filha" de CommissionBonusRule mas carrega o
-- próprio organizationId (mesmo padrão de CommissionTable, filha de
-- ConsortiumAdministrator): nunca depender só do JOIN com o pai pra isolar
-- por organização.
ALTER TABLE "CommissionIndividualGoal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionIndividualGoal" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CommissionIndividualGoal"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "CommissionBonusRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionBonusRule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CommissionBonusRule"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "CommissionBonusTier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionBonusTier" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CommissionBonusTier"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "CommissionBonusAward" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionBonusAward" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CommissionBonusAward"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
