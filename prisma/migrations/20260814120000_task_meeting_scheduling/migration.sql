-- Suporte a agendamento automático de reuniões via API v1 (landing page
-- externa de captação de leads pro Meta Ads — ver
-- app/api/v1/availability/route.ts e app/api/v1/appointments/route.ts).
-- Nenhuma policy de RLS nova é necessária aqui: a tabela "Task" já tem
-- tenant_isolation por linha desde a migration
-- 20260708125234_enable_row_level_security, e nem ADD COLUMN nem um índice
-- novo mudam isso.

-- Id do evento criado no Google Agenda do consultor quando a reunião é
-- marcada por este fluxo — permite atualizar/cancelar o evento de verdade
-- depois (hoje só existe leitura, ver fetchGoogleCalendarEvents em
-- lib/google-calendar-oauth.ts). Nullable: nem toda Task é uma reunião
-- sincronizada com o Google (só quando o consultor tem
-- GoogleCalendarConnection e a chamada ao Google funcionou nessa hora).
-- IF NOT EXISTS: esta migration falhou na 1ª tentativa (índice abaixo, não
-- esta coluna — ver comentário dele) e já tinha aplicado este ADD COLUMN
-- antes de falhar; idempotente pra poder reaplicar o arquivo inteiro.
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "googleEventId" TEXT;

-- Trava a nível de banco contra dupla reserva do mesmo horário pro mesmo
-- consultor — é o que garante atomicidade real entre dois leads da landing
-- page escolhendo o mesmo slot ao mesmo tempo em POST /api/v1/appointments
-- (checar disponibilidade em memória sozinho, sem constraint no banco,
-- deixaria uma janela clássica de corrida TOCTOU entre o "confere se está
-- livre" e o "grava a reserva"). Parcial (só type='MEETING' e dueAt
-- preenchido) porque as outras Tasks (CALL/WHATSAPP/NOTE/...) não têm essa
-- regra de "um por horário" — várias podem compartilhar o mesmo dueAt sem
-- problema nenhum.
--
-- `dueAt >= '2026-08-01'`: na 1ª tentativa esta CREATE UNIQUE INDEX falhou
-- de verdade (não é só teórico) — a tabela já tem 124 grupos (259 linhas)
-- de Task type=MEETING com (ownerId, dueAt) duplicado, todos import
-- histórico do Agendor (data mais recente encontrada: 2026-07-06, já no
-- passado; zero conflito a partir de agora). A regra de negócio só precisa
-- proteger reservas NOVAS feitas por este endpoint (ninguém agenda reunião
-- no passado) — o corte exclui esse lixo histórico sem precisar limpar/
-- deduplicar dado antigo pra poder criar o índice. Não dá pra usar
-- CURRENT_DATE/now() aqui (Postgres exige que o predicado de um índice use
-- só função IMMUTABLE) — por isso o literal fixo, com folga de duas
-- semanas antes de hoje (14/08/2026).
CREATE UNIQUE INDEX IF NOT EXISTS "Task_owner_meeting_slot_unique"
  ON "Task" ("ownerId", "dueAt")
  WHERE "type" = 'MEETING' AND "dueAt" IS NOT NULL AND "dueAt" >= '2026-08-01 00:00:00';
