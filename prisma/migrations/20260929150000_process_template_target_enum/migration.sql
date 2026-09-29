-- ProcessTemplateUsage.target era texto livre (validado só no código, ver app/api/processes/[id]/send-template/route.ts)
-- e virou enum de verdade no schema — faltava esta migração, achada numa auditoria de drift (prisma migrate diff)
-- antes de um deploy. USING "target"::"ProcessTemplateTarget" é seguro: a rota só grava 'CONSULTANT'/'LEAD' há tempos.
CREATE TYPE "ProcessTemplateTarget" AS ENUM ('CONSULTANT', 'LEAD');

ALTER TABLE "ProcessTemplateUsage"
  ALTER COLUMN "target" TYPE "ProcessTemplateTarget" USING "target"::"ProcessTemplateTarget";
