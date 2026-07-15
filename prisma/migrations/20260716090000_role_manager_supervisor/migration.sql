-- Hierarquia de papéis: Dono (OWNER) -> Gerente (MANAGER) -> Supervisor
-- (SUPERVISOR) -> Membro (MEMBER). ADMIN vira MANAGER (poder administrativo
-- de organização inteira); SUPERVISOR é novo (lidera só a própria equipe via
-- Team.leaderId, sem acesso administrativo). Ver lib/team-scope.ts.
ALTER TYPE "OrgRole" RENAME VALUE 'ADMIN' TO 'MANAGER';
ALTER TYPE "OrgRole" ADD VALUE 'SUPERVISOR' AFTER 'MANAGER';

-- Gerente pode supervisionar várias equipes ao mesmo tempo — espelha
-- exatamente leaderId (mesmo padrão de FK/índice), só que 1 User pode ser
-- managerId de N Teams diferentes.
ALTER TABLE "Team" ADD COLUMN "managerId" TEXT;
ALTER TABLE "Team" ADD CONSTRAINT "Team_managerId_fkey"
  FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Team_organizationId_managerId_idx" ON "Team"("organizationId", "managerId");
