-- Presença do WhatsApp (online/digitando/visto por último) — ver
-- lib/whatsapp/events.ts's handlePresenceUpdate e
-- app/api/whatsapp/messages/[threadId]/route.ts (renovação de inscrição).
ALTER TABLE "WhatsAppThread" ADD COLUMN "presenceStatus" TEXT;
ALTER TABLE "WhatsAppThread" ADD COLUMN "presenceUpdatedAt" TIMESTAMP(3);
ALTER TABLE "WhatsAppThread" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "WhatsAppThread" ADD COLUMN "presenceSubscribedAt" TIMESTAMP(3);
