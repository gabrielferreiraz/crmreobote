-- Por que uma campanha está PAUSED sem o usuário ter clicado em "Pausar" (o WhatsApp caiu, instabilidade
-- do número, falhas seguidas) e qual WhatsApp a derrubou — pra ela retomar SOZINHA quando ele reconectar
-- (ver Campaign.pausedReason no schema e lib/campaigns/instance-guard.ts). Colunas opcionais: campanha
-- existente segue exatamente igual — pausa sem motivo é pausa manual e nunca retoma sozinha. Aditiva: o
-- código antigo ignora as colunas.
ALTER TABLE "Campaign" ADD COLUMN "pausedReason" TEXT,
ADD COLUMN "pausedInstanceId" TEXT;
