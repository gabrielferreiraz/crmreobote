-- Tabelas de crédito da Servopa (ver "Tabelas Servopa" em schema.prisma):
-- grupos, tabelas (uma por aba "Taxa de Adm"), linhas por categoria e o
-- histórico de execuções do robô. SQL gerado pelo `prisma migrate diff` a
-- partir do schema (sem tocar em banco) + RLS por organização à mão, igual às
-- demais tabelas do CRM.


-- CreateEnum
CREATE TYPE "ServopaSegment" AS ENUM ('REAL_ESTATE', 'MOVABLE');

-- CreateEnum
CREATE TYPE "ServopaSyncTrigger" AS ENUM ('SCHEDULED', 'MANUAL', 'IMPORT');

-- CreateEnum
CREATE TYPE "ServopaSyncStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "ServopaGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "segment" "ServopaSegment" NOT NULL,
    "totalMonths" INTEGER,
    "vacancies" INTEGER,
    "dueDay" INTEGER,
    "nextAssemblyNumber" TEXT,
    "nextAssemblyAt" TIMESTAMP(3),
    "reserveFundPercent" DECIMAL(7,4),
    "insuranceRatePercent" DECIMAL(7,4),
    "insuranceType" TEXT,
    "groupType" TEXT,
    "drawType" TEXT,
    "embeddedBidMaxPercent" DECIMAL(7,4),
    "membersCount" INTEGER,
    "contemplationText" TEXT NOT NULL DEFAULT '',
    "rawInfo" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServopaGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServopaTable" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "admRatePercent" DECIMAL(7,4) NOT NULL,
    "adjustmentPoints" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "adjustedById" TEXT,
    "adjustedAt" TIMESTAMP(3),
    "termMonths" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServopaTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServopaTableRow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "creditValue" DECIMAL(14,2) NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "monthlyPercent" DECIMAL(8,4) NOT NULL,
    "installment" DECIMAL(14,2) NOT NULL,
    "insurance" DECIMAL(14,2) NOT NULL,
    "observation" TEXT,
    "total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "ServopaTableRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServopaSyncRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "trigger" "ServopaSyncTrigger" NOT NULL,
    "status" "ServopaSyncStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "summary" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServopaSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServopaGroup_organizationId_active_idx" ON "ServopaGroup"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ServopaGroup_organizationId_number_key" ON "ServopaGroup"("organizationId", "number");

-- CreateIndex
CREATE INDEX "ServopaTable_organizationId_active_idx" ON "ServopaTable"("organizationId", "active");

-- CreateIndex
CREATE INDEX "ServopaTable_organizationId_termMonths_idx" ON "ServopaTable"("organizationId", "termMonths");

-- CreateIndex
CREATE UNIQUE INDEX "ServopaTable_groupId_admRatePercent_key" ON "ServopaTable"("groupId", "admRatePercent");

-- CreateIndex
CREATE INDEX "ServopaTableRow_organizationId_idx" ON "ServopaTableRow"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ServopaTableRow_tableId_category_key" ON "ServopaTableRow"("tableId", "category");

-- CreateIndex
CREATE INDEX "ServopaSyncRun_organizationId_createdAt_idx" ON "ServopaSyncRun"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "ServopaGroup" ADD CONSTRAINT "ServopaGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServopaTable" ADD CONSTRAINT "ServopaTable_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ServopaGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServopaTableRow" ADD CONSTRAINT "ServopaTableRow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServopaTableRow" ADD CONSTRAINT "ServopaTableRow_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "ServopaTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServopaSyncRun" ADD CONSTRAINT "ServopaSyncRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RLS: nada vaza entre organizações mesmo se uma query esquecer o filtro.
ALTER TABLE "ServopaGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServopaGroup" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ServopaGroup"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "ServopaTable" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServopaTable" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ServopaTable"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "ServopaTableRow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServopaTableRow" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ServopaTableRow"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "ServopaSyncRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServopaSyncRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ServopaSyncRun"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
