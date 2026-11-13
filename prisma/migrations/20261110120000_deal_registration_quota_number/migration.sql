-- Cota e dígito da cota cadastrada pelo administrativo (o grupo já existia em groupNumber).
-- Migration aditiva: duas colunas opcionais, sem mexer em nada existente.
ALTER TABLE "DealRegistration" ADD COLUMN "quotaNumber" TEXT;
ALTER TABLE "DealRegistration" ADD COLUMN "quotaDigit" TEXT;
