-- Nome público opcional do cartão de visita. NULL mantém o nome do usuário
-- no CRM; este campo não altera User.name.
ALTER TABLE "DigitalCard" ADD COLUMN "displayNameOverride" TEXT;
