-- Process.value — ver comentário no model Process (schema).
--
-- Motivo: processo sem negócio (contemplado vindo da lista do administrativo)
-- não tem de onde herdar valor, então aparecia como "—" no card do Kanban e
-- somava 0 em todo relatório. Este campo é o complemento: quando existe
-- negócio, ele continua mandando (`deal?.value ?? value`).
--
-- Mesma precisão de Deal.value (12,2) pra Kanban e relatório somarem os dois
-- sem conversão.
--
-- Aditivo: coluna nova nasce NULL em todas as linhas existentes.
--
-- Escrita à mão (não gerada por `prisma migrate dev`): a shadow database do
-- migrate dev falha numa migração ANTERIOR e não relacionada
-- (20260812090000_tv_dashboard_config_rls, ver comentário lá).

ALTER TABLE "Process" ADD COLUMN "value" DECIMAL(12,2);
