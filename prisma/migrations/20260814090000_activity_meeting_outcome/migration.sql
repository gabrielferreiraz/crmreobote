-- Resultado de uma Activity type MEETING/VISIT (compareceu/não compareceu/
-- remarcou) — ver lib/meta-ads/attribution.ts (conta no-show do funil de
-- Facebook) e negocios/[id]/deal-detail.tsx (onde é perguntado). Nullable e
-- sem valor default de propósito: histórico já existente fica sem resposta
-- registrada (tratado como "compareceu" nas contagens, não some da conta —
-- ver comentário no schema). Só ADD COLUMN + o enum novo — a policy
-- tenant_isolation que a tabela Activity já tem (ver migration
-- 20260708125234) é por linha, cobre a coluna nova automaticamente.
CREATE TYPE "ActivityMeetingOutcome" AS ENUM ('ATTENDED', 'NO_SHOW', 'RESCHEDULED');

ALTER TABLE "Activity" ADD COLUMN "meetingOutcome" "ActivityMeetingOutcome";
