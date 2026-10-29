-- A "Taxa Adm." da tabela do documento é a ADM somada ao fundo de reserva do
-- grupo; guardar o fundo junto da cota mantém a linha reproduzível depois que
-- o robô recoletar as tabelas. Nulo quando a Servopa não publicou o fundo.
ALTER TABLE "ProposalQuota" ADD COLUMN "reserveFundPercent" DECIMAL(7,4);
