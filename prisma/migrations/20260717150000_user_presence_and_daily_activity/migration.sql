-- AlterTable
ALTER TABLE "OrganizationUser" ADD COLUMN "lastActiveAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "UserDailyActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "activeSeconds" INTEGER NOT NULL DEFAULT 0,
    "changeCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDailyActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserDailyActivity_organizationId_userId_date_key" ON "UserDailyActivity"("organizationId", "userId", "date");

-- CreateIndex
CREATE INDEX "UserDailyActivity_organizationId_date_idx" ON "UserDailyActivity"("organizationId", "date");

-- AddForeignKey
ALTER TABLE "UserDailyActivity" ADD CONSTRAINT "UserDailyActivity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDailyActivity" ADD CONSTRAINT "UserDailyActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (mesmo padrão de LeadSource/CreditType/JobTitle — ver lib/tenant-context.ts)
ALTER TABLE "UserDailyActivity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserDailyActivity" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "UserDailyActivity"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
