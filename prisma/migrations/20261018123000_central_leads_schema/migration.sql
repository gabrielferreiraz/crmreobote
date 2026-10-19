-- Central de Leads do WhatsApp. Migration aditiva e escrita a mao.
-- O ciclo OPEN/CLOSED e exclusivo da Central: inboxStatus permanece NULL
-- nas threads pessoais existentes e nas novas threads pessoais.

-- CreateEnum
CREATE TYPE "WhatsAppInstanceKind" AS ENUM ('PERSONAL', 'CENTRAL');
CREATE TYPE "WhatsAppInboxStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "WhatsAppAssignmentSource" AS ENUM (
    'CONTACT_RESPONSIBLE',
    'OPEN_DEAL_OWNER',
    'ROUND_ROBIN',
    'MANUAL_CLAIM',
    'MANUAL_TRANSFER',
    'REOPEN',
    'USER_DEACTIVATED',
    'NO_ELIGIBLE_MEMBER'
);

-- AlterTable: a coluna fisica userId continua com o mesmo nome. PERSONAL
-- mantem o FK atual em ON DELETE CASCADE; CENTRAL usa userId NULL.
ALTER TABLE "WhatsAppInstance"
    ALTER COLUMN "userId" DROP NOT NULL,
    ADD COLUMN "kind" "WhatsAppInstanceKind" NOT NULL DEFAULT 'PERSONAL',
    ADD COLUMN "connectedById" TEXT,
    ADD COLUMN "distributionPoolId" TEXT;

ALTER TABLE "WhatsAppThread"
    ADD COLUMN "assigneeId" TEXT,
    ADD COLUMN "inboxStatus" "WhatsAppInboxStatus",
    ADD COLUMN "assignedAt" TIMESTAMP(3),
    ADD COLUMN "closedAt" TIMESTAMP(3),
    ADD COLUMN "assignmentSource" "WhatsAppAssignmentSource",
    ADD COLUMN "routingAppliedAt" TIMESTAMP(3);

ALTER TABLE "WhatsAppMessage"
    ADD COLUMN "attributedUserId" TEXT;

ALTER TABLE "Contact"
    ADD COLUMN "needsEnrichment" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "LeadDistributionPool" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadDistributionPool_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadDistributionPoolMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "pausedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadDistributionPoolMember_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LeadDistributionPoolMember_position_check" CHECK ("position" >= 0)
);

CREATE TABLE "LeadDistributionCursor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "nextIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadDistributionCursor_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LeadDistributionCursor_nextIndex_check" CHECK ("nextIndex" >= 0)
);

CREATE TABLE "WhatsAppAssignmentEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "triggerMessageId" TEXT,
    "fromAssigneeId" TEXT,
    "toAssigneeId" TEXT,
    "actorUserId" TEXT,
    "source" "WhatsAppAssignmentSource" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppAssignmentEvent_pkey" PRIMARY KEY ("id")
);

-- CheckConstraint: torna impossivel criar PERSONAL sem dono ou CENTRAL com
-- dono pessoal. A propriedade da Central e sempre a Organization.
ALTER TABLE "WhatsAppInstance"
    ADD CONSTRAINT "WhatsAppInstance_kind_personalOwner_check" CHECK (
        ("kind" = 'PERSONAL' AND "userId" IS NOT NULL)
        OR ("kind" = 'CENTRAL' AND "userId" IS NULL)
    );

-- CreateIndex
-- PostgreSQL permite varios NULL no unique atual (organizationId, userId,
-- provider). Este indice parcial garante uma unica Central por provider.
CREATE UNIQUE INDEX "WhatsAppInstance_organizationId_provider_central_key"
    ON "WhatsAppInstance"("organizationId", "provider")
    WHERE "kind" = 'CENTRAL';
CREATE INDEX "WhatsAppInstance_organizationId_kind_idx" ON "WhatsAppInstance"("organizationId", "kind");
CREATE INDEX "WhatsAppInstance_distributionPoolId_idx" ON "WhatsAppInstance"("distributionPoolId");

CREATE INDEX "WhatsAppThread_org_assignee_status_lastMessage_idx"
    ON "WhatsAppThread"("organizationId", "assigneeId", "inboxStatus", "lastMessageAt");
CREATE INDEX "WhatsAppThread_org_status_lastMessage_idx"
    ON "WhatsAppThread"("organizationId", "inboxStatus", "lastMessageAt");
CREATE INDEX "WhatsAppMessage_org_attributed_createdAt_idx"
    ON "WhatsAppMessage"("organizationId", "attributedUserId", "createdAt");

CREATE UNIQUE INDEX "LeadDistributionPool_organizationId_name_key"
    ON "LeadDistributionPool"("organizationId", "name");
CREATE INDEX "LeadDistributionPool_organizationId_active_idx"
    ON "LeadDistributionPool"("organizationId", "active");

CREATE UNIQUE INDEX "LeadDistributionPoolMember_poolId_userId_key"
    ON "LeadDistributionPoolMember"("poolId", "userId");
CREATE INDEX "LeadDistributionPoolMember_organizationId_userId_idx"
    ON "LeadDistributionPoolMember"("organizationId", "userId");
CREATE INDEX "LeadDistributionPoolMember_poolId_pausedAt_position_idx"
    ON "LeadDistributionPoolMember"("poolId", "pausedAt", "position");

CREATE UNIQUE INDEX "LeadDistributionCursor_poolId_key" ON "LeadDistributionCursor"("poolId");
CREATE INDEX "LeadDistributionCursor_organizationId_idx" ON "LeadDistributionCursor"("organizationId");

CREATE UNIQUE INDEX "WhatsAppAssignmentEvent_triggerMessageId_key"
    ON "WhatsAppAssignmentEvent"("triggerMessageId");
CREATE INDEX "WhatsAppAssignmentEvent_org_thread_createdAt_idx"
    ON "WhatsAppAssignmentEvent"("organizationId", "threadId", "createdAt");
CREATE INDEX "WhatsAppAssignmentEvent_org_assignee_createdAt_idx"
    ON "WhatsAppAssignmentEvent"("organizationId", "toAssigneeId", "createdAt");

-- AddForeignKey
-- O FK fisico WhatsAppInstance_userId_fkey nao e recriado: ele continua
-- exatamente como hoje, ON DELETE CASCADE, para instancias PERSONAL.
ALTER TABLE "WhatsAppInstance" ADD CONSTRAINT "WhatsAppInstance_connectedById_fkey"
    FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WhatsAppInstance" ADD CONSTRAINT "WhatsAppInstance_distributionPoolId_fkey"
    FOREIGN KEY ("distributionPoolId") REFERENCES "LeadDistributionPool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WhatsAppThread" ADD CONSTRAINT "WhatsAppThread_assigneeId_fkey"
    FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_attributedUserId_fkey"
    FOREIGN KEY ("attributedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LeadDistributionPool" ADD CONSTRAINT "LeadDistributionPool_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeadDistributionPoolMember" ADD CONSTRAINT "LeadDistributionPoolMember_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadDistributionPoolMember" ADD CONSTRAINT "LeadDistributionPoolMember_poolId_fkey"
    FOREIGN KEY ("poolId") REFERENCES "LeadDistributionPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadDistributionPoolMember" ADD CONSTRAINT "LeadDistributionPoolMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeadDistributionCursor" ADD CONSTRAINT "LeadDistributionCursor_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadDistributionCursor" ADD CONSTRAINT "LeadDistributionCursor_poolId_fkey"
    FOREIGN KEY ("poolId") REFERENCES "LeadDistributionPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WhatsAppAssignmentEvent" ADD CONSTRAINT "WhatsAppAssignmentEvent_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppAssignmentEvent" ADD CONSTRAINT "WhatsAppAssignmentEvent_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "WhatsAppThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppAssignmentEvent" ADD CONSTRAINT "WhatsAppAssignmentEvent_triggerMessageId_fkey"
    FOREIGN KEY ("triggerMessageId") REFERENCES "WhatsAppMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WhatsAppAssignmentEvent" ADD CONSTRAINT "WhatsAppAssignmentEvent_fromAssigneeId_fkey"
    FOREIGN KEY ("fromAssigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WhatsAppAssignmentEvent" ADD CONSTRAINT "WhatsAppAssignmentEvent_toAssigneeId_fkey"
    FOREIGN KEY ("toAssigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WhatsAppAssignmentEvent" ADD CONSTRAINT "WhatsAppAssignmentEvent_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS: copiado do padrao mais recente em
-- 20261016120000_commission_tables_client_payments/migration.sql.
ALTER TABLE "LeadDistributionPool" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadDistributionPool" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LeadDistributionPool"
    USING ("organizationId" = current_setting('app.current_organization_id', true))
    WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "LeadDistributionPoolMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadDistributionPoolMember" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LeadDistributionPoolMember"
    USING ("organizationId" = current_setting('app.current_organization_id', true))
    WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "LeadDistributionCursor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadDistributionCursor" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LeadDistributionCursor"
    USING ("organizationId" = current_setting('app.current_organization_id', true))
    WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "WhatsAppAssignmentEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppAssignmentEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WhatsAppAssignmentEvent"
    USING ("organizationId" = current_setting('app.current_organization_id', true))
    WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
