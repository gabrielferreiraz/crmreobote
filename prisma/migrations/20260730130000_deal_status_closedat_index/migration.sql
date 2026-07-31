-- Relatórios agrupam negócios WON/LOST filtrando organizationId+status+
-- intervalo de closedAt — o índice existente (organizationId, status) não
-- cobre closedAt, então um filtro de período ainda varria todo o status
-- antes de descartar as linhas fora do intervalo.
CREATE INDEX "Deal_organizationId_status_closedAt_idx" ON "Deal"("organizationId", "status", "closedAt");
