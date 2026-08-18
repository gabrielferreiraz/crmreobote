-- Compartilhamento de agenda entre consultores: grupos nomeados (ex.:
-- "Marketing Digital") onde todo membro vê a agenda de todo membro — ver
-- lib/agenda-share.ts. Ortogonal a Team (pode cruzar equipes de vendas
-- diferentes), afeta só a Agenda, nunca Pipeline/Relatórios.

CREATE TABLE "AgendaShareGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgendaShareGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgendaShareGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "AgendaShareGroupMember_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgendaShareGroup_organizationId_idx" ON "AgendaShareGroup"("organizationId");
CREATE UNIQUE INDEX "AgendaShareGroupMember_groupId_userId_key" ON "AgendaShareGroupMember"("groupId", "userId");
CREATE INDEX "AgendaShareGroupMember_userId_idx" ON "AgendaShareGroupMember"("userId");

ALTER TABLE "AgendaShareGroup" ADD CONSTRAINT "AgendaShareGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgendaShareGroup" ADD CONSTRAINT "AgendaShareGroup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgendaShareGroupMember" ADD CONSTRAINT "AgendaShareGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AgendaShareGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgendaShareGroupMember" ADD CONSTRAINT "AgendaShareGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS — AgendaShareGroup tem organizationId próprio; AgendaShareGroupMember
-- não tem (mesmo padrão de PipelineStage, ver 20260708125234_enable_row_
-- level_security): restrita via subquery na tabela pai.
ALTER TABLE "AgendaShareGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgendaShareGroup" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AgendaShareGroup"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "AgendaShareGroupMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgendaShareGroupMember" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AgendaShareGroupMember"
  USING (EXISTS (
    SELECT 1 FROM "AgendaShareGroup" g
    WHERE g.id = "AgendaShareGroupMember"."groupId"
    AND g."organizationId" = current_setting('app.current_organization_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "AgendaShareGroup" g
    WHERE g.id = "AgendaShareGroupMember"."groupId"
    AND g."organizationId" = current_setting('app.current_organization_id', true)
  ));
