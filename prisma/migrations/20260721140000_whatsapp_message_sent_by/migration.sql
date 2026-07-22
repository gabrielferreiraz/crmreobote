ALTER TABLE "WhatsAppMessage" ADD COLUMN "sentByUserId" TEXT;

ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_sentByUserId_fkey"
  FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
