-- Índice por data em CronRun (aditivo, sem mudar dado nenhum).
-- A tela "Saúde do sistema" lista as últimas execuções de TODOS os crons
-- (ORDER BY "startedAt" DESC LIMIT 100) e a retenção de 30 dias apaga por
-- "startedAt" (ver lib/cron-run-cleanup.ts). O único índice existente começa
-- por "name", então as duas consultas varriam a tabela inteira (518 mil linhas
-- em 27/11/2026, crescendo ~5 mil por dia).
CREATE INDEX IF NOT EXISTS "CronRun_startedAt_idx" ON "CronRun"("startedAt");
