/**
 * Monta a lista de conversas (uma por contato, com a mensagem mais recente)
 * pra alimentar a tela de Conversas — o inbox unificado de WhatsApp. Usado
 * tanto na renderização inicial da página quanto na rota que o polling do
 * cliente chama, pra não duplicar a query nos dois lugares.
 */

import { prisma } from "@/lib/prisma";
import { whatsappScopeWhere, type DealScope } from "@/lib/team-scope";

const PREVIEW_FALLBACK: Record<string, string> = {
  IMAGE: "📷 Imagem",
  AUDIO: "🎵 Áudio",
  CONTACT: "👤 Contato",
  PIX: "💰 Pix",
};

export type ConversationSummary = {
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  lastMessagePreview: string;
  lastMessageDirection: "INBOUND" | "OUTBOUND";
  lastMessageAt: Date;
  unreadCount: number;
  deal: { id: string; name: string } | null;
};

export async function listConversations(organizationId: string, scope: DealScope): Promise<ConversationSummary[]> {
  const instanceWhere = whatsappScopeWhere(scope);

  const latestMessages = await prisma.whatsAppMessage.findMany({
    where: { organizationId, ...instanceWhere },
    orderBy: { createdAt: "desc" },
    distinct: ["contactId"],
    include: { contact: { select: { id: true, name: true, whatsapp: true, phone: true } } },
  });

  const contactIds = latestMessages.map((m) => m.contactId);
  if (contactIds.length === 0) return [];

  const [unreadCounts, openDeals] = await Promise.all([
    prisma.whatsAppMessage.groupBy({
      by: ["contactId"],
      where: {
        organizationId,
        direction: "INBOUND",
        read: false,
        contactId: { in: contactIds },
        ...instanceWhere,
      },
      _count: { _all: true },
    }),
    prisma.deal.findMany({
      where: { organizationId, contactId: { in: contactIds }, status: "OPEN" },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, contactId: true },
    }),
  ]);

  const unreadByContact = new Map(unreadCounts.map((u) => [u.contactId, u._count._all]));
  const dealByContact = new Map<string, { id: string; name: string }>();
  for (const deal of openDeals) {
    if (!dealByContact.has(deal.contactId)) dealByContact.set(deal.contactId, { id: deal.id, name: deal.name });
  }

  return latestMessages.map((msg) => ({
    contactId: msg.contactId,
    contactName: msg.contact.name,
    contactPhone: msg.contact.whatsapp || msg.contact.phone,
    lastMessagePreview: msg.body || PREVIEW_FALLBACK[msg.type] || "—",
    lastMessageDirection: msg.direction,
    lastMessageAt: msg.createdAt,
    unreadCount: unreadByContact.get(msg.contactId) ?? 0,
    deal: dealByContact.get(msg.contactId) ?? null,
  }));
}
