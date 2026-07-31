-- Denormaliza a hora da última mensagem/chamada em WhatsAppThread — sem
-- isso, a tela de Conversas (e o polling a cada 5s que a mantém atualizada,
-- ver lib/whatsapp/conversations.ts) precisava buscar TODA thread da
-- organização com a última mensagem de cada uma via join, só pra ordenar em
-- JavaScript. Backfill a partir de WhatsAppMessage.createdAt existente;
-- threads sem nenhuma mensagem ficam com null (não aparecem na lista de
-- Conversas de qualquer forma).
ALTER TABLE "WhatsAppThread" ADD COLUMN "lastMessageAt" TIMESTAMP(3);

CREATE INDEX "WhatsAppThread_organizationId_lastMessageAt_idx" ON "WhatsAppThread"("organizationId", "lastMessageAt");

UPDATE "WhatsAppThread" t
SET "lastMessageAt" = sub."maxCreatedAt"
FROM (
  SELECT "threadId", MAX("createdAt") AS "maxCreatedAt"
  FROM "WhatsAppMessage"
  GROUP BY "threadId"
) sub
WHERE sub."threadId" = t.id;
