-- Slide de aniversário no carrossel de anúncios da TV: fundo padrão + foto
-- recortada (sem fundo) de cada consultor. Só uma coluna nova; nada existente
-- muda. TvDashboardConfig já tem RLS, a policy vale pra coluna nova também.
ALTER TABLE "TvDashboardConfig" ADD COLUMN "birthdaySlide" JSONB NOT NULL DEFAULT '{}';
