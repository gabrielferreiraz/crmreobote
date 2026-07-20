/**
 * Suspensão de contato pra disparo em massa — dois motivos, sempre
 * respeitados antes de mandar mensagem de campanha (inicial ou follow-up):
 *
 * 1. Opt-out explícito (ver lib/whatsapp/opt-out.ts) — pediu pra parar,
 *    nunca mais entra em campanha nenhuma.
 * 2. "Cold streak" — mandamos mensagem em campanhas anteriores e a pessoa
 *    nunca respondeu nenhuma vez. Insistir com quem já demonstrou (com o
 *    silêncio repetido) que não tem interesse é exatamente o padrão que a
 *    própria WhatsApp usa como sinal de spam ("baixa taxa de resposta"), não
 *    só desperdício de mensagem.
 *
 * Em nenhum dos dois casos isso bloqueia mensagem manual avulsa (vendedor
 * respondendo o próprio contato pelo chat) — só disparo em massa.
 */

import { prisma } from "@/lib/prisma";

/** Quantas campanhas em que a pessoa recebeu mensagem e nunca respondeu, antes de suspender disparo em massa pra ela. */
const COLD_STREAK_THRESHOLD = 3;

export type SuppressionReason = "opt-out" | "cold-streak";

export async function getSuppressionReason(contactId: string): Promise<SuppressionReason | null> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { whatsappOptOutAt: true },
  });
  if (contact?.whatsappOptOutAt) return "opt-out";

  const neverRepliedCount = await prisma.campaignRecipient.count({
    where: { contactId, status: "SENT", repliedAt: null },
  });
  if (neverRepliedCount >= COLD_STREAK_THRESHOLD) return "cold-streak";

  return null;
}

const SUPPRESSION_MESSAGES: Record<SuppressionReason, string> = {
  "opt-out": "Contato pediu pra não receber mais mensagens — suspenso de disparos em massa.",
  "cold-streak": `Contato recebeu ${COLD_STREAK_THRESHOLD}+ campanhas sem responder nenhuma — suspenso de disparos em massa.`,
};

export function suppressionMessage(reason: SuppressionReason): string {
  return SUPPRESSION_MESSAGES[reason];
}
