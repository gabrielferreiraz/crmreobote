-- CreateTable
CREATE TABLE "MonthlyGoal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "MonthlyGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyGoal_organizationId_year_month_key" ON "MonthlyGoal"("organizationId", "year", "month");

-- CreateIndex
CREATE INDEX "MonthlyGoal_organizationId_idx" ON "MonthlyGoal"("organizationId");

-- AddForeignKey
ALTER TABLE "MonthlyGoal" ADD CONSTRAINT "MonthlyGoal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyGoal" ADD CONSTRAINT "MonthlyGoal_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS (mesmo padrão de LeadSource/CreditType/JobTitle — ver lib/tenant-context.ts)
ALTER TABLE "MonthlyGoal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MonthlyGoal" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MonthlyGoal"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
