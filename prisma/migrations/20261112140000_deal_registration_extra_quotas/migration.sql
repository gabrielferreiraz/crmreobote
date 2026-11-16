-- Cotas extras da mesma venda (ver lib/deal-registration/extra-quotas.ts).
-- Aditiva: coluna nova, opcional, sem default e sem reescrever linha nenhuma.
-- Cadastro sem cota extra continua com NULL, que o leitor trata como lista vazia.
ALTER TABLE "DealRegistration" ADD COLUMN "extraQuotas" JSONB;
