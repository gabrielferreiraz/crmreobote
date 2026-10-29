-- Cotas aderidas a uma proposta: uma linha por grupo/categoria da tabela que
-- o documento imprime. Ver o comentário do model ProposalQuota no schema.
CREATE TABLE "ProposalQuota" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "servopaTableId" TEXT NOT NULL,
    "groupNumber" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "admPercent" DECIMAL(7,4) NOT NULL,
    "creditValue" DECIMAL(12,2) NOT NULL,
    "installment" DECIMAL(12,2) NOT NULL,
    "quotaCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalQuota_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProposalQuota_proposalId_servopaTableId_category_key"
    ON "ProposalQuota"("proposalId", "servopaTableId", "category");
CREATE INDEX "ProposalQuota_organizationId_idx" ON "ProposalQuota"("organizationId");
CREATE INDEX "ProposalQuota_proposalId_idx" ON "ProposalQuota"("proposalId");
CREATE INDEX "ProposalQuota_servopaTableId_idx" ON "ProposalQuota"("servopaTableId");

ALTER TABLE "ProposalQuota" ADD CONSTRAINT "ProposalQuota_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProposalQuota" ADD CONSTRAINT "ProposalQuota_proposalId_fkey"
    FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sem FK para "ServopaTable" de propósito: a coleta do robô desativa e recria
-- tabelas, e a cota de uma proposta já enviada não pode sumir junto nem
-- travar a coleta.

ALTER TABLE "ProposalQuota" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProposalQuota" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProposalQuota"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
