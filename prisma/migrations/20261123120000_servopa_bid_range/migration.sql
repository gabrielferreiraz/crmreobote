-- Faixa (mínimo/máximo) de lances já vistos vencendo nas assembleias de cada
-- grupo Servopa, vinda da coluna "Lance" da listagem (/vendas/grupos) — até
-- aqui essa coluna era lida pelo robô e descartada. Migration aditiva: só
-- duas colunas opcionais em ServopaGroup, nulas até a primeira coleta que
-- trouxer um lance legível.

ALTER TABLE "ServopaGroup" ADD COLUMN "bidOfferedMinPercent" DECIMAL(7,4);
ALTER TABLE "ServopaGroup" ADD COLUMN "bidOfferedMaxPercent" DECIMAL(7,4);
