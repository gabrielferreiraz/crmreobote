-- Troca a faixa de lances (migration anterior) pelo total de contemplados.
-- Motivo: a coluna "Lance" da listagem (/vendas/grupos) saiu sempre 0,00% na
-- primeira coleta real em produção — não é o resultado por assembleia (esse
-- só aparece num popup "Sobre a Assembleia" que o robô ainda não lê), então
-- não dava pra confiar nela. "Contemplados" (mesma linha da listagem) é o
-- total acumulado do grupo e já veio com números reais na mesma coleta.
-- Migration aditiva/limpeza: nenhuma linha tinha outro valor além de 0,0000
-- nas duas colunas antigas (conferido antes desta migration), então não há
-- dado real para preservar.

ALTER TABLE "ServopaGroup" DROP COLUMN "bidOfferedMinPercent";
ALTER TABLE "ServopaGroup" DROP COLUMN "bidOfferedMaxPercent";
ALTER TABLE "ServopaGroup" ADD COLUMN "contemplatedCount" INTEGER;
