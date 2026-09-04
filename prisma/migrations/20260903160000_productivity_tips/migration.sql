-- Dicas de produtividade (ver lib/productivity-tips/) — popup contextual
-- (WhatsApp desconectado, negócios acumulados em etapa de no-show, muitas
-- tarefas de WhatsApp pendentes), sem IA, só medição/regra em código.
-- Tabela nova, mesmo padrão de RLS simples de organizationId próprio (ver
-- 20260903090000_undoable_action como referência de estilo).

CREATE TYPE "ProductivityTipType" AS ENUM (
  'WHATSAPP_DISCONNECTED',
  'NOSHOW_DEALS',
  'MANY_WHATSAPP_TASKS',
  'STALE_DEALS',
  'NO_MESSAGE_SCRIPTS'
);

CREATE TABLE "ProductivityTipDismissal" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "tipType" "ProductivityTipType" NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
  "dismissDate" TIMESTAMP(3) NOT NULL,
  "forever" BOOLEAN NOT NULL DEFAULT false,
  "dismissedBy" TEXT NOT NULL,
  "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductivityTipDismissal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductivityTipDismissal_tipType_scope_dismissedBy_dismissDate_forever_key"
  ON "ProductivityTipDismissal"("tipType", "scope", "dismissedBy", "dismissDate", "forever");

CREATE INDEX "ProductivityTipDismissal_organizationId_dismissedBy_tipType_scope_idx"
  ON "ProductivityTipDismissal"("organizationId", "dismissedBy", "tipType", "scope");

ALTER TABLE "ProductivityTipDismissal"
  ADD CONSTRAINT "ProductivityTipDismissal_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductivityTipDismissal"
  ADD CONSTRAINT "ProductivityTipDismissal_dismissedBy_fkey"
  FOREIGN KEY ("dismissedBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductivityTipDismissal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductivityTipDismissal" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProductivityTipDismissal"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
