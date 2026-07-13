-- CreateTable
CREATE TABLE "MessageScript" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageScript_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MessageScript_organizationId_idx" ON "MessageScript"("organizationId");

ALTER TABLE "MessageScript" ADD CONSTRAINT "MessageScript_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageScript" ADD CONSTRAINT "MessageScript_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MessageScript" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MessageScript" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MessageScript"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
