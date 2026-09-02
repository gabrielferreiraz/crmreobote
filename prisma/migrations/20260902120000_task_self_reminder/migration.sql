-- Aviso automático PUSH pro PRÓPRIO consultor antes de uma Reunião — caminho
-- irmão do bloco reminder* (esse é WhatsApp pro CLIENTE, ver migração
-- 20260821090000_task_meeting_google_meet_and_reminder), escolhido no mesmo
-- botão "Programar aviso automático" do MeetingInviteDialog, agora com um
-- garfo "Avisar cliente" vs "Me avisar". Sem sequência/Script (é só 1 push,
-- texto sempre gerado pelo sistema) — ver lib/tasks/meeting-reminder.ts.
-- Nenhuma coluna nova aqui precisa de policy de RLS própria: são só colunas
-- a mais na "Task", que já tem tenant_isolation por linha desde
-- 20260708125234_enable_row_level_security.
ALTER TABLE "Task" ADD COLUMN "selfReminderMinutesBefore" INTEGER;
ALTER TABLE "Task" ADD COLUMN "selfReminderSendAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "selfReminderSentAt" TIMESTAMP(3);
