-- Marca uma Origem (LeadSource) como "conta como anúncio" no relatório de
-- Facebook/Instagram — ver lib/meta-ads/attribution.ts. Default false: não
-- muda o relatório de ninguém sozinho, é opt-in manual em Configurações →
-- Origens. Não mexe em RLS: a policy de tenant_isolation já existente na
-- tabela LeadSource cobre a coluna nova automaticamente (policy é por
-- linha, não por coluna).
ALTER TABLE "LeadSource" ADD COLUMN "countsAsAd" BOOLEAN NOT NULL DEFAULT false;
