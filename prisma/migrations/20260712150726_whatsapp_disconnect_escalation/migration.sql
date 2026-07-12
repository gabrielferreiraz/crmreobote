-- AlterTable
ALTER TABLE "WhatsAppInstance" ADD COLUMN "disconnectedAt" TIMESTAMP(3),
ADD COLUMN "disconnectAlertLevel" INTEGER NOT NULL DEFAULT 0;
