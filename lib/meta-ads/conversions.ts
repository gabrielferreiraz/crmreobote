/**
 * Avisa a Meta (Conversions API) quando um negócio vira GANHO — só roda se a
 * organização tiver conectado Meta Ads E preenchido um Pixel ID (os dois
 * opcionais; sem isso, no-op silencioso). Nunca bloqueia a ação principal
 * (marcar negócio como ganho) — sempre chamado com .catch() no call site,
 * mesmo padrão de enqueueWebhookEvent (lib/webhooks/enqueue.ts).
 */

import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/security/secret-crypto";
import { sendConversionEvent } from "@/lib/meta-ads";

type DealForConversion = {
  id: string;
  value: number | null;
  contact: { email: string | null; phone: string | null; whatsapp: string | null };
};

export async function notifyMetaConversionWon(organizationId: string, deal: DealForConversion): Promise<void> {
  const connection = await prisma.metaAdsConnection.findUnique({ where: { organizationId } });
  if (!connection?.pixelId) return;

  const phone = deal.contact.whatsapp || deal.contact.phone;
  if (!deal.contact.email && !phone) {
    console.log(`[meta-ads] negócio ${deal.id} ganho, mas contato sem e-mail/telefone — nada pra mandar pro Pixel`);
    return;
  }

  const accessToken = decryptSecret(connection.pageAccessTokenEncrypted);
  await sendConversionEvent(connection.pixelId, accessToken, {
    eventName: "Purchase",
    eventTime: new Date(),
    // Dedup do lado da Meta — o mesmo negócio nunca deveria virar dois
    // eventos, mesmo que este código rode mais de uma vez pro mesmo id.
    eventId: `deal:${deal.id}`,
    user: { email: deal.contact.email, phone },
    value: deal.value ?? undefined,
  });
  console.log(`[meta-ads] evento de conversão (Purchase) mandado pro Pixel — negócio ${deal.id}`);
}
