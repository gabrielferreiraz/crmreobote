-- Evolui ServopaSyncRun para uma fila reivindicável pelo worker do notebook.
-- Mudança somente aditiva; grupos, tabelas, linhas e ajustes não são tocados.

ALTER TABLE "ServopaSyncRun"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "claimedAt" TIMESTAMP(3),
  ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3),
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "leaseTokenHash" TEXT,
  ADD COLUMN "progress" JSONB,
  ADD COLUMN "errorCode" TEXT;

-- Proteção para instalações que, por intervenção manual, já tenham mais de um
-- job ativo. Mantém o mais recente e encerra os anteriores antes do índice.
WITH ranked AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "organizationId"
    ORDER BY "createdAt" DESC, "id" DESC
  ) AS position
  FROM "ServopaSyncRun"
  WHERE "status" IN ('PENDING', 'RUNNING')
)
UPDATE "ServopaSyncRun" AS run
SET
  "status" = 'FAILED',
  "finishedAt" = CURRENT_TIMESTAMP,
  "errorCode" = 'DUPLICATE_ACTIVE_JOB',
  "error" = 'Execução encerrada durante a ativação da fila: havia outro trabalho mais recente.'
FROM ranked
WHERE run."id" = ranked."id" AND ranked.position > 1;

CREATE INDEX "ServopaSyncRun_status_nextAttemptAt_idx"
  ON "ServopaSyncRun"("status", "nextAttemptAt");

CREATE INDEX "ServopaSyncRun_organizationId_status_createdAt_idx"
  ON "ServopaSyncRun"("organizationId", "status", "createdAt");

-- Prisma não representa índice parcial no schema; ele fica documentado e
-- protegido nesta migration. Impede duplicidade mesmo sob corrida entre nós.
CREATE UNIQUE INDEX "ServopaSyncRun_one_active_per_org_key"
  ON "ServopaSyncRun"("organizationId")
  WHERE "status" IN ('PENDING', 'RUNNING');
