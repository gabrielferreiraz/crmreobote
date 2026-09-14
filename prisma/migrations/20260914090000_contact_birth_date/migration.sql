-- Escrita à mão (não gerada por `prisma migrate dev`) — a shadow database
-- usada pra gerar migração automaticamente já falha numa migração ANTERIOR
-- e não relacionada (20260812090000_tv_dashboard_config_rls, ver comentário
-- lá: TvDashboardConfig existia no banco real fora do histórico de
-- migração, então a shadow db, que reaplica tudo do zero, nunca chega a
-- criar essa tabela antes do ALTER TABLE dela rodar). Mesma sintaxe exata
-- de 20260818114548_user_birth_date (User.birthDate), só que em Contact.
ALTER TABLE "Contact" ADD COLUMN "birthDate" DATE;
