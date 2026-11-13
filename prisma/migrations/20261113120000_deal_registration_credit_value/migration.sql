-- Valor do crédito da cota principal (as extras já guardam o seu dentro de
-- "extraQuotas"). Aditiva: coluna nova, opcional, sem default — cadastro
-- antigo fica NULL e nada é reescrito.
ALTER TABLE "DealRegistration" ADD COLUMN "creditValue" DECIMAL(12,2);
