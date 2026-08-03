-- Mensagem de WhatsApp programada numa tarefa (type=WHATSAPP) — sentAt/
-- failedAt nulos = ainda pendente; uma vez setado (sucesso OU falha
-- permanente), o cron (lib/tasks/scheduled-whatsapp.ts) nunca mais
-- reprocessa essa tarefa. Falha de envio não tem retry automático, por
-- decisão de produto.
ALTER TABLE "Task" ADD COLUMN "scheduledMessageText" TEXT;
ALTER TABLE "Task" ADD COLUMN "scheduledMessageSentAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "scheduledMessageFailedAt" TIMESTAMP(3);
