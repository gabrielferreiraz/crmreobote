-- Visibilidade nos rankings da TV, separada de countsTowardGoal (ver
-- OrganizationUser.showInPodium/showInMonthRanking no schema). Escrita à mão
-- (migrate dev quebrado na shadow database, ver migrações anteriores).

ALTER TABLE "OrganizationUser" ADD COLUMN "showInPodium" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "OrganizationUser" ADD COLUMN "showInMonthRanking" BOOLEAN NOT NULL DEFAULT true;

-- Backfill preservando o comportamento de hoje: até aqui os rankings excluíam
-- quem não conta na meta (Dono), então quem tem countsTowardGoal = false
-- continua fora dos dois.
UPDATE "OrganizationUser" SET "showInPodium" = false, "showInMonthRanking" = false WHERE "countsTowardGoal" = false;

-- O pedido em si: supervisor sai do pódio da TV principal (continua no
-- Ranking do mês completo e continua contando na meta).
UPDATE "OrganizationUser" SET "showInPodium" = false WHERE "role" = 'SUPERVISOR';
