-- ApiKey: prazo de validade opcional (nulo = nunca expira)
ALTER TABLE "ApiKey" ADD COLUMN "expiresAt" TIMESTAMP(3);

-- AuditLog: trilha de ações administrativas críticas
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "detail" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS — mesmo padrão de Team/Contact/Deal (ver 20260708125234_enable_row_level_security)
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditLog"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
