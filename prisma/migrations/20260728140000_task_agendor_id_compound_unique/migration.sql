-- Corrige Task.agendorTaskId: não pode ser único sozinho, porque uma tarefa
-- do Agendor com mais de um responsável vira uma linha POR responsável na
-- importação (ver scripts/import-agendor.ts) — o mesmo Código da tarefa
-- aparece então em mais de uma linha de propósito. O que precisa ser único
-- é a combinação (agendorTaskId, ownerId).

DROP INDEX "Task_agendorTaskId_key";
CREATE UNIQUE INDEX "Task_agendorTaskId_ownerId_key" ON "Task"("agendorTaskId", "ownerId");
