-- Histórico de execução dos crons (automations/campaigns/db-backup/
-- webhooks/whatsapp-health) — sucesso/falha/detalhe de cada tick, pra
-- alimentar a página "Saúde do sistema" (Configurações, OWNER-only) e o
-- alerta por e-mail em lib/system-alerts.ts. Sem organizationId e SEM RLS
-- de propósito: infraestrutura do deploy, não dado de um tenant (mesmo
-- raciocínio de "Organization", que também não tem RLS).
CREATE TABLE "CronRun" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "success" BOOLEAN NOT NULL,
    "detail" TEXT,

    CONSTRAINT "CronRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CronRun_name_startedAt_idx" ON "CronRun"("name", "startedAt");
