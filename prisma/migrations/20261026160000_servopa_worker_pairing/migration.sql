-- Instalador de uso único do robô Servopa. O arquivo baixado no CRM carrega um
-- código curto; o computador troca esse código pela própria chave `svw_...`.
-- Só o SHA-256 do código é salvo, ele expira em 1 hora e vale uma única vez.
-- Migration aditiva: cria somente esta tabela.

CREATE TABLE "ServopaWorkerPairing" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "workerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ServopaWorkerPairing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServopaWorkerPairing_codeHash_key" ON "ServopaWorkerPairing"("codeHash");
CREATE INDEX "ServopaWorkerPairing_organizationId_expiresAt_idx" ON "ServopaWorkerPairing"("organizationId", "expiresAt");

ALTER TABLE "ServopaWorkerPairing"
  ADD CONSTRAINT "ServopaWorkerPairing_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServopaWorkerPairing"
  ADD CONSTRAINT "ServopaWorkerPairing_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- O código do instalador carrega o id da organização (não é segredo), então o
-- resgate roda com o tenant normal: nenhuma regra de bootstrap extra.
ALTER TABLE "ServopaWorkerPairing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServopaWorkerPairing" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "ServopaWorkerPairing"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
