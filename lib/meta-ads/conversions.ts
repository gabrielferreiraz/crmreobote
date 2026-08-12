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

type ContactForConversion = {
  id: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
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

/**
 * Avisa a Meta (Conversions API) quando um lead é classificado como
 * QUALIFIED pelo consultor — evento padrão "Lead", pra alimentar o
 * algoritmo de otimização da campanha de origem. Desqualificado NUNCA
 * manda nada pra Meta — só fica registrado no relatório interno (ver
 * lib/meta-ads/attribution.ts). Não existe um evento "lead ruim" no
 * vocabulário da Conversions API; mandar "Lead" de novo nesse caso só
 * ensinaria o algoritmo a buscar MAIS gente parecida com quem a gente
 * decidiu que não serve — por isso o chamador (PATCH
 * /api/contacts/[id]/lead-qualification) só invoca esta função na
 * transição PARA "QUALIFIED", nunca pra "UNQUALIFIED". Mesmo comportamento
 * de sempre: silencioso se não houver Meta Ads conectado ou Pixel ID
 * cadastrado.
 */
export async function notifyMetaLeadQualification(
  organizationId: string,
  contact: ContactForConversion,
): Promise<void> {
  const connection = await prisma.metaAdsConnection.findUnique({ where: { organizationId } });
  if (!connection?.pixelId) return;

  const phone = contact.whatsapp || contact.phone;
  if (!contact.email && !phone) {
    console.log(`[meta-ads] contato ${contact.id} qualificado, mas sem e-mail/telefone — nada pra mandar pro Pixel`);
    return;
  }

  const accessToken = decryptSecret(connection.pageAccessTokenEncrypted);
  await sendConversionEvent(connection.pixelId, accessToken, {
    eventName: "Lead",
    eventTime: new Date(),
    eventId: `contact:${contact.id}:lead:qualified`,
    user: { email: contact.email, phone },
  });
  console.log(`[meta-ads] evento Lead mandado pro Pixel — contato ${contact.id} qualificado`);
}
