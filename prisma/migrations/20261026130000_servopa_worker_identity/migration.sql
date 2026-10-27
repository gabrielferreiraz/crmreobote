-- Identidade dedicada e revogável do notebook do robô Servopa.
-- A chave pura nunca é persistida; keyHash contém apenas SHA-256.

CREATE TABLE "ServopaWorker" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "keyPrefix" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "lastSeenAt" TIMESTAMP(3),
  "version" TEXT,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ServopaWorker_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServopaWorker_keyHash_key" ON "ServopaWorker"("keyHash");
CREATE INDEX "ServopaWorker_organizationId_active_idx" ON "ServopaWorker"("organizationId", "active");
CREATE UNIQUE INDEX "ServopaWorker_one_active_per_org_key"
  ON "ServopaWorker"("organizationId")
  WHERE "active" = true;

ALTER TABLE "ServopaWorker"
  ADD CONSTRAINT "ServopaWorker_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServopaWorker"
  ADD CONSTRAINT "ServopaWorker_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ServopaWorker" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServopaWorker" FORCE ROW LEVEL SECURITY;

-- Bootstrap: antes de autenticar, o CRM conhece somente o hash da chave.
-- A própria linha pode ser lida/atualizada por esse hash para descobrir a
-- organização e registrar lastSeenAt; nenhuma outra tabela ganha esse acesso.
CREATE POLICY tenant_isolation ON "ServopaWorker"
  USING (
    "organizationId" = current_setting('app.current_organization_id', true)
    OR "keyHash" = current_setting('app.current_servopa_worker_key_hash', true)
  )
  WITH CHECK (
    "organizationId" = current_setting('app.current_organization_id', true)
    OR "keyHash" = current_setting('app.current_servopa_worker_key_hash', true)
  );
