-- Ctrl+Z do sistema (ver lib/undo/) — cada linha é uma ação que pode ser
-- revertida via POST /api/undo/[id]. Tabela nova, mesmo padrão de RLS
-- simples de organizationId próprio (ver 20260815100000_agenda_share_groups
-- como referência de estilo — sem subquery, essa tabela já tem a coluna).

CREATE TABLE "UndoableAction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "undoneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UndoableAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UndoableAction_organizationId_userId_createdAt_idx" ON "UndoableAction"("organizationId", "userId", "createdAt");

ALTER TABLE "UndoableAction" ADD CONSTRAINT "UndoableAction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UndoableAction" ADD CONSTRAINT "UndoableAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UndoableAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UndoableAction" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "UndoableAction"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
