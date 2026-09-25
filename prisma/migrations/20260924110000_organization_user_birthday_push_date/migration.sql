-- Marcador do push de aniversário de cliente no primeiro acesso do dia (ver
-- lib/birthdays.ts). Coluna nullable, sem default e sem backfill: null = "nunca
-- avisado ainda", que é exatamente o estado certo pra todo mundo hoje.
ALTER TABLE "OrganizationUser" ADD COLUMN "birthdayPushDate" TEXT;
