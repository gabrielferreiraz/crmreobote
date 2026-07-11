-- AlterTable
ALTER TABLE "WhatsAppMessage" ADD COLUMN     "rawPayload" JSONB,
ADD COLUMN     "replyToId" TEXT;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "WhatsAppMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
