-- Visibilidade por script: PUBLIC (padrão, toda a organização vê/usa) ou
-- PRIVATE (só quem criou, mais o OWNER — mesmo acesso administrativo total
-- que já tem em Auditoria/Membros). Default PUBLIC preserva o comportamento
-- de hoje pra toda linha existente e pra qualquer script novo que não passar
-- o campo — só ADD COLUMN, a policy tenant_isolation que MessageScript já
-- tem (ver migration 20260708125234 ou equivalente) é por linha, cobre a
-- coluna nova automaticamente.
CREATE TYPE "MessageScriptVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

ALTER TABLE "MessageScript" ADD COLUMN "visibility" "MessageScriptVisibility" NOT NULL DEFAULT 'PUBLIC';
