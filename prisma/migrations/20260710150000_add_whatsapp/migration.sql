-- Nova ação de automação
ALTER TYPE "AutomationAction" ADD VALUE 'SEND_WHATSAPP';

-- CreateEnum
CREATE TYPE "WhatsAppInstanceStatus" AS ENUM ('DISCONNECTED', 'CONNECTING', 'CONNECTED');

-- CreateEnum
CREATE TYPE "WhatsAppMessageDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "WhatsAppMessageStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateTable
CREATE TABLE "WhatsAppInstance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "status" "WhatsAppInstanceStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "direction" "WhatsAppMessageDirection" NOT NULL,
    "body" TEXT,
    "mediaUrl" TEXT,
    "status" "WhatsAppMessageStatus" NOT NULL DEFAULT 'PENDING',
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppInstance_instanceName_key" ON "WhatsAppInstance"("instanceName");

-- CreateIndex
CREATE INDEX "WhatsAppInstance_organizationId_idx" ON "WhatsAppInstance"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppInstance_organizationId_userId_key" ON "WhatsAppInstance"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_externalId_key" ON "WhatsAppMessage"("externalId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_organizationId_contactId_createdAt_idx" ON "WhatsAppMessage"("organizationId", "contactId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_organizationId_instanceId_idx" ON "WhatsAppMessage"("organizationId", "instanceId");

-- AddForeignKey
ALTER TABLE "WhatsAppInstance" ADD CONSTRAINT "WhatsAppInstance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppInstance" ADD CONSTRAINT "WhatsAppInstance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WhatsAppInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: mesma política de isolamento por organizationId usada nas demais tabelas.
ALTER TABLE "WhatsAppInstance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppInstance" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WhatsAppInstance"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

ALTER TABLE "WhatsAppMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppMessage" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WhatsAppMessage"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
