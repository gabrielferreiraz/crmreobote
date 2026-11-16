-- Meia ou integral da cota principal (as extras guardam o seu dentro de
-- "extraQuotas"). Aditiva: coluna nova, opcional, sem default — cadastro
-- antigo fica NULL (lido como integral) e nada é reescrito.
ALTER TABLE "DealRegistration" ADD COLUMN "quotaKind" TEXT;
