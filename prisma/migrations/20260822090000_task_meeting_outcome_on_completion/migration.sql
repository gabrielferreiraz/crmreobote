-- Resultado de Reunião/Visita passa a ser perguntado na CONCLUSÃO da Task,
-- não mais na criação (ver comentário em ActivityMeetingOutcome no schema).
-- Precisa de 2 coisas novas:
--
-- 1) Um estado "aguardando resposta" no enum — não reaproveita null
--    (esse já significa "histórico antigo, nunca vamos saber", tratado como
--    compareceu nas contagens; PENDING é "ainda não sabemos, mas vamos
--    saber quando a Task concluir" — precisa ficar de FORA da taxa, não
--    contar como compareceu).
-- 2) Um jeito de saber QUAL Activity atualizar quando a Task concluir —
--    não existia nenhum vínculo Task↔Activity até agora.
--
-- RLS: a policy tenant_isolation de Task já existe (linha, não coluna) e
-- cobre a coluna nova automaticamente, mesma lógica já documentada em
-- 20260814090000_activity_meeting_outcome/migration.sql.
ALTER TYPE "ActivityMeetingOutcome" ADD VALUE 'PENDING';

ALTER TABLE "Task" ADD COLUMN "activityId" TEXT;

CREATE UNIQUE INDEX "Task_activityId_key" ON "Task"("activityId");

ALTER TABLE "Task" ADD CONSTRAINT "Task_activityId_fkey"
  FOREIGN KEY ("activityId") REFERENCES "Activity"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
