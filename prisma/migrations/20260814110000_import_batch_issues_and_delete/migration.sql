-- issueRows: motivo de cada linha não importada, guardado no momento da
-- importação (ver app/api/deals/import/route.ts) — permite "baixar
-- planilha de erros" e ver detalhe no histórico depois, mesmo que o
-- arquivo original já tenha sumido do computador de quem importou.
-- deletedAt: marca quando alguém desfez a importação (ver DELETE
-- /api/deals/import/[id]) — o registro continua existindo, só some o que
-- deu pra apagar com segurança.
ALTER TABLE "ImportBatch" ADD COLUMN "issueRows" JSONB;
ALTER TABLE "ImportBatch" ADD COLUMN "deletedAt" TIMESTAMP(3);
