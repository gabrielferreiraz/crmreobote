-- Se um dono ATIVO recebe o e-mail técnico de "cron parou de rodar"
-- (lib/system-alerts.ts) — ver comentário completo em
-- prisma/schema.prisma, campo OrganizationUser.receiveCronAlerts.
-- Default true: ninguém que já recebia fica sem avisar do nada só por
-- este campo ter sido criado.
ALTER TABLE "OrganizationUser" ADD COLUMN "receiveCronAlerts" BOOLEAN NOT NULL DEFAULT true;
