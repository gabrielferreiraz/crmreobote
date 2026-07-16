-- CreateTable
CREATE TABLE "CreditType" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreditType_organizationId_idx" ON "CreditType"("organizationId");

-- AddForeignKey
ALTER TABLE "CreditType" ADD CONSTRAINT "CreditType_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (mesmo padrão de LeadSource/CustomFieldDefinition — ver lib/tenant-context.ts)
ALTER TABLE "CreditType" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreditType" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CreditType"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
