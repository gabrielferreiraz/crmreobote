-- Reconciliação pro backfill de Reuniões/Visitas migradas do Agendor (ver
-- scripts/agendor/backfill-meeting-visit-activities.ts) — mesma chave
-- (agendorTaskId, userId) já usada em Task, pra criar no máximo uma
-- Activity por Task migrada, seguro pra rodar de novo.
ALTER TABLE "Activity" ADD COLUMN "agendorTaskId" TEXT;

CREATE UNIQUE INDEX "Activity_agendorTaskId_userId_key" ON "Activity"("agendorTaskId", "userId");
