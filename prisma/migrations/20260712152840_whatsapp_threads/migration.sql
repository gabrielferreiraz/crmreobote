-- CreateTable: WhatsAppThread — uma conversa existe por si só, não depende
-- mais de um Contact já cadastrado (ver lib/whatsapp/threads.ts).
CREATE TABLE "WhatsAppThread" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "whatsappName" TEXT,
    "contactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppThread_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppThread_instanceId_phoneNormalized_key" ON "WhatsAppThread"("instanceId", "phoneNormalized");
CREATE INDEX "WhatsAppThread_organizationId_contactId_idx" ON "WhatsAppThread"("organizationId", "contactId");
CREATE INDEX "WhatsAppThread_organizationId_idx" ON "WhatsAppThread"("organizationId");

ALTER TABLE "WhatsAppThread" ADD CONSTRAINT "WhatsAppThread_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppThread" ADD CONSTRAINT "WhatsAppThread_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WhatsAppInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppThread" ADD CONSTRAINT "WhatsAppThread_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS: mesmo padrão tenant_isolation usado em toda tabela com organizationId próprio.
ALTER TABLE "WhatsAppThread" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppThread" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WhatsAppThread"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

-- Backfill: uma thread por par (instanceId, contactId) já existente em
-- WhatsAppMessage — volume real hoje é mínimo, mas preserva qualquer
-- conversa que já exista.
INSERT INTO "WhatsAppThread" ("id", "organizationId", "instanceId", "phoneNormalized", "contactId", "createdAt", "updatedAt")
SELECT
  'wt_' || substr(md5(random()::text || clock_timestamp()::text || m."contactId"), 1, 20),
  m."organizationId",
  m."instanceId",
  COALESCE(c."whatsappNormalized", c."phoneNormalized", 'desconhecido'),
  c."id",
  now(),
  now()
FROM (SELECT DISTINCT "organizationId", "instanceId", "contactId" FROM "WhatsAppMessage") m
JOIN "Contact" c ON c."id" = m."contactId";

-- AlterTable: WhatsAppMessage passa a apontar pra thread, não mais direto pro Contact.
ALTER TABLE "WhatsAppMessage" ADD COLUMN "threadId" TEXT;

UPDATE "WhatsAppMessage" m
SET "threadId" = t."id"
FROM "WhatsAppThread" t
WHERE t."instanceId" = m."instanceId" AND t."contactId" = m."contactId";

ALTER TABLE "WhatsAppMessage" ALTER COLUMN "threadId" SET NOT NULL;

ALTER TABLE "WhatsAppMessage" DROP CONSTRAINT "WhatsAppMessage_contactId_fkey";
DROP INDEX "WhatsAppMessage_organizationId_contactId_createdAt_idx";
DROP INDEX "WhatsAppMessage_organizationId_contactId_direction_read_idx";
ALTER TABLE "WhatsAppMessage" DROP COLUMN "contactId";

ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "WhatsAppThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "WhatsAppMessage_organizationId_threadId_createdAt_idx" ON "WhatsAppMessage"("organizationId", "threadId", "createdAt");
CREATE INDEX "WhatsAppMessage_organizationId_threadId_direction_read_idx" ON "WhatsAppMessage"("organizationId", "threadId", "direction", "read");
