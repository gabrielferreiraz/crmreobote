-- Link do Google Meet criado junto com o evento de reunião (googleEventId,
-- já existente) quando o consultor pede e tem GoogleCalendarConnection com
-- permissão de escrita — ver createGoogleCalendarEvent em
-- lib/google-calendar-oauth.ts e app/api/tasks/[id]/create-google-meet.
ALTER TABLE "Task" ADD COLUMN "googleMeetLink" TEXT;

-- Aviso automático de WhatsApp antes de uma Reunião, com suporte a
-- sequência de mensagens (Script existente, com delay entre etapas) ou uma
-- mensagem avulsa — ver lib/tasks/meeting-reminder.ts. Nenhuma coluna nova
-- aqui precisa de policy de RLS própria: são só colunas a mais na "Task",
-- que já tem tenant_isolation por linha desde
-- 20260708125234_enable_row_level_security.
ALTER TABLE "Task" ADD COLUMN "reminderMinutesBefore" INTEGER;
ALTER TABLE "Task" ADD COLUMN "reminderSteps" JSONB;
ALTER TABLE "Task" ADD COLUMN "reminderStepIndex" INTEGER;
ALTER TABLE "Task" ADD COLUMN "reminderNextSendAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "reminderSentAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "reminderFailedAt" TIMESTAMP(3);
