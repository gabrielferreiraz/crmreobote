-- Lembretes push persistentes por usuário e evento administrativo.
-- A leitura e a resolução são estados distintos: abrir faz parar a repetição para
-- aquela pessoa; concluir a pendência encerra o evento para todos.

CREATE TYPE "PushReminderKind" AS ENUM (
  'ADMIN_QUOTA_REGISTRATION',
  'ADMIN_PROCESS_REQUEST',
  'ADMIN_DOCUMENT_RESPONSE'
);

CREATE TABLE "PushReminder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "PushReminderKind" NOT NULL,
    "eventKey" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "url" TEXT NOT NULL,
    "firstSentAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "nextSendAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushReminder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushReminder_organizationId_userId_eventKey_key"
  ON "PushReminder"("organizationId", "userId", "eventKey");
CREATE INDEX "PushReminder_organizationId_openedAt_resolvedAt_nextSendAt_idx"
  ON "PushReminder"("organizationId", "openedAt", "resolvedAt", "nextSendAt");
CREATE INDEX "PushReminder_organizationId_userId_scopeKey_idx"
  ON "PushReminder"("organizationId", "userId", "scopeKey");

ALTER TABLE "PushReminder"
  ADD CONSTRAINT "PushReminder_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushReminder"
  ADD CONSTRAINT "PushReminder_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PushReminder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PushReminder" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PushReminder"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
