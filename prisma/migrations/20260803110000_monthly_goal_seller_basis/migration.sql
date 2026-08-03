-- Guarda quantos consultores (MEMBER) ativos existiam quando a meta do mês
-- foi salva por último — permite sugerir atualizar a meta só quando o
-- tamanho do time muda depois, sem repetir a sugestão toda vez que o valor
-- salvo simplesmente não bater com "quantidade de vendedores x R$1,2M"
-- (meta pode ter sido ajustada de propósito pra outro valor). Nullable:
-- linhas já existentes ficam sem base conhecida, então nunca disparam a
-- sugestão de atualização (só uma base conhecida permite comparar).
ALTER TABLE "MonthlyGoal" ADD COLUMN "basedOnSellerCount" INTEGER;
