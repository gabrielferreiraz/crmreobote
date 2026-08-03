-- Alvo de quem a automação age (além do gatilho, que continua sendo pra
-- organização inteira): Dono/Gerente escolhem Todos/Eu/Usuários específicos/
-- Equipe ao criar; regra de Supervisor/Consultor é sempre SELF, forçado no
-- servidor (ver app/api/automations).
CREATE TYPE "AutomationTargetType" AS ENUM ('EVERYONE', 'SELF', 'USERS', 'TEAM');

ALTER TABLE "AutomationRule" ADD COLUMN "targetType" "AutomationTargetType" NOT NULL DEFAULT 'EVERYONE';
ALTER TABLE "AutomationRule" ADD COLUMN "targetUserIds" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "AutomationRule" ADD COLUMN "targetTeamId" TEXT;

ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_targetTeamId_fkey" FOREIGN KEY ("targetTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "AutomationRule_organizationId_targetTeamId_idx" ON "AutomationRule"("organizationId", "targetTeamId");

-- Defensivo: qualquer regra que já tenha sido criada por Supervisor/Consultor
-- entre a coluna createdById existir e esta migration (nenhuma na prática,
-- mas por precaução) precisa nascer como SELF, nunca EVERYONE.
UPDATE "AutomationRule" r
SET "targetType" = 'SELF'
FROM "OrganizationUser" ou
WHERE r."createdById" = ou."userId"
  AND r."organizationId" = ou."organizationId"
  AND ou.role NOT IN ('OWNER', 'MANAGER');
