-- Separa o link público da TV principal (DASHBOARD) do link do Ranking do mês
-- (RANKING), uma TV interna à parte — ver TvDisplayLinkKind no schema.
--
-- Escrita à mão (não gerada por `prisma migrate dev`): a shadow database do
-- migrate dev falha numa migração ANTERIOR e não relacionada
-- (20260812090000_tv_dashboard_config_rls), então toda migração nova neste repo
-- é escrita e aplicada manualmente.
--
-- Aditiva e instantânea: o DEFAULT constante faz o Postgres preencher a coluna
-- sem reescrever a tabela, e todo link já existente vira 'DASHBOARD' (é
-- exatamente o que ele é). A policy de RLS de TvDisplayLink é por linha
-- (organizationId / hash do token), então não muda com a coluna nova.

CREATE TYPE "TvDisplayLinkKind" AS ENUM ('DASHBOARD', 'RANKING');

ALTER TABLE "TvDisplayLink" ADD COLUMN "kind" "TvDisplayLinkKind" NOT NULL DEFAULT 'DASHBOARD';
