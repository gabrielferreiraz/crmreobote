ALTER TABLE "Process" ADD COLUMN "contemplatedAt" TIMESTAMP(3);

-- Backfill best-esforço pra processos já marcados como contemplados antes
-- deste campo existir: usa a 1ª entrada numa etapa com "contempl" no nome
-- (era a única fonte disponível até agora — ver admin-reports-view.tsx),
-- e cai pra updatedAt se não achar nenhuma (nunca deixa null quem já está
-- marcado contemplated=true, pra não sumir da métrica de quem já tem o
-- marcador certo hoje).
UPDATE "Process" p
SET "contemplatedAt" = COALESCE(
  (
    SELECT MIN(h."changedAt")
    FROM "ProcessStageHistory" h
    JOIN "ProcessStage" s ON s.id = h."toStageId"
    WHERE h."processId" = p.id AND s.name ILIKE '%contempl%'
  ),
  p."updatedAt"
)
WHERE p.contemplated = true;
