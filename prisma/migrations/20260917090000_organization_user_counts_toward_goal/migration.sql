-- Escrita à mão (não gerada por `prisma migrate dev`) — a shadow database
-- usada pra gerar migração automaticamente ainda falha numa migração
-- anterior e não relacionada (20260812090000_tv_dashboard_config_rls).
--
-- "Conta na meta" — se as vendas GANHAS desta pessoa entram na meta mensal
-- da organização e nos números "de ganho" do dashboard da TV (ver comentário
-- completo em prisma/schema.prisma, campo OrganizationUser.countsTowardGoal).
-- Pedido explícito: sócio (Dono) pode fechar negócio da própria Reobote de
-- vez em quando, mas isso não deve contar como meta do time.
ALTER TABLE "OrganizationUser" ADD COLUMN "countsTowardGoal" BOOLEAN NOT NULL DEFAULT true;

-- Backfill: quem já é Dono HOJE começa desativado (o pedido é especificamente
-- sobre sócios) — todo o resto (Consultor/Supervisor/Gerente já existentes)
-- fica no default true da coluna, sem precisar de UPDATE nenhum pra eles.
UPDATE "OrganizationUser" SET "countsTowardGoal" = false WHERE "role" = 'OWNER';
