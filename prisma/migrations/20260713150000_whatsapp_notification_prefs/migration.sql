-- AlterTable
ALTER TABLE "WhatsAppInstance" ADD COLUMN "notifyOnCrmMessage" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "WhatsAppInstance" ADD COLUMN "notifyOnGeralMessage" BOOLEAN NOT NULL DEFAULT true;
