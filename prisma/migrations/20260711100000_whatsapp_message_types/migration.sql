-- CreateEnum
CREATE TYPE "WhatsAppMessageType" AS ENUM ('TEXT', 'IMAGE', 'AUDIO', 'CONTACT', 'PIX', 'BUTTONS', 'LIST');

-- AlterTable
ALTER TABLE "WhatsAppMessage" ADD COLUMN "type" "WhatsAppMessageType" NOT NULL DEFAULT 'TEXT';
ALTER TABLE "WhatsAppMessage" ADD COLUMN "metadata" JSONB;
