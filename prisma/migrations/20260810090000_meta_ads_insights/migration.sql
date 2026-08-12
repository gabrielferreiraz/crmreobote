-- Suporte a gasto/leads/CPL do Meta Ads (Insights API) — ver
-- lib/meta-ads/insights.ts. Token de usuário separado do token de Página já
-- existente (só ele consulta Insights de Ad Account); Ad Account escolhida
-- pra reportar. Todas nullable: conexão existente continua funcionando pro
-- que já fazia (Lead Ads + Conversions API), só fica sem o resumo de gasto
-- até reconectar. Só ADD COLUMN — a policy tenant_isolation que já existe
-- na tabela (ver migration 20260719170000) é por linha, cobre as colunas
-- novas automaticamente, não precisa recriar nada.
ALTER TABLE "MetaAdsConnection" ADD COLUMN "userAccessTokenEncrypted" TEXT;
ALTER TABLE "MetaAdsConnection" ADD COLUMN "adAccountId" TEXT;
ALTER TABLE "MetaAdsConnection" ADD COLUMN "adAccountName" TEXT;
ALTER TABLE "MetaAdsConnection" ADD COLUMN "adAccountCurrency" TEXT;
