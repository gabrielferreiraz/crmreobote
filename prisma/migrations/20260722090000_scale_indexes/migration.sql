-- Índices que cobrem o ORDER BY das listagens de alto volume (Clientes,
-- Pipeline, Agenda) — sem eles, mesmo com take/skip no lado da aplicação, o
-- Postgres ainda precisaria ordenar todo o conjunto filtrado em memória
-- antes de recortar a página.
CREATE INDEX "Contact_organizationId_createdAt_idx" ON "Contact"("organizationId", "createdAt");

CREATE INDEX "Deal_organizationId_pipelineId_status_stageEnteredAt_idx" ON "Deal"("organizationId", "pipelineId", "status", "stageEnteredAt");

CREATE INDEX "Task_organizationId_completedAt_dueAt_idx" ON "Task"("organizationId", "completedAt", "dueAt");
