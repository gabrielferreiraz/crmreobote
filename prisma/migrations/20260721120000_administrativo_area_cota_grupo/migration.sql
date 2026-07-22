-- Usuário "Administrativo" como experiência separada (área própria, não só
-- uma permissão) + campos de Cota/Grupo do consórcio no Processo + notas de
-- Processo reaproveitando Activity. Tudo aditivo: novo enum, colunas
-- nullable/com default, nenhuma tabela nova.

CREATE TYPE "UserArea" AS ENUM ('VENDAS', 'ADMINISTRATIVO');
ALTER TABLE "OrganizationUser" ADD COLUMN "area" "UserArea" NOT NULL DEFAULT 'VENDAS';

ALTER TABLE "Process" ADD COLUMN "quotaNumber" TEXT;
ALTER TABLE "Process" ADD COLUMN "groupNumber" TEXT;
CREATE INDEX "Process_organizationId_quotaNumber_idx" ON "Process"("organizationId", "quotaNumber");
CREATE INDEX "Process_organizationId_groupNumber_idx" ON "Process"("organizationId", "groupNumber");

ALTER TABLE "Activity" ADD COLUMN "processId" TEXT;
CREATE INDEX "Activity_organizationId_processId_createdAt_idx" ON "Activity"("organizationId", "processId", "createdAt");
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_processId_fkey" FOREIGN KEY ("processId") REFERENCES "Process"("id") ON DELETE CASCADE ON UPDATE CASCADE;
