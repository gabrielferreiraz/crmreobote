/**
 * Monta a lista de conversas pra alimentar a tela de Conversas — o inbox
 * unificado de WhatsApp (abas "CRM"/"Geral", ver conversations-view.tsx).
 * Usado tanto na renderização inicial da página quanto na rota que o
 * polling do cliente chama, pra não duplicar a query nos dois lugares.
 */

import { prisma } from "@/lib/prisma";
import { whatsappScopeWhere, type DealScope } from "@/lib/team-scope";
import { formatBrazilianPhone } from "@/lib/phone-normalize";

const PREVIEW_FALLBACK: Record<string, string> = {
  IMAGE: "📷 Imagem",
  AUDIO: "🎵 Áudio",
  CONTACT: "👤 Contato",
  PIX: "💰 Pix",
  STICKER: "🧩 Figurinha",
};

export type ConversationSummary = {
  threadId: string;
  /** null = ainda não vinculada a nenhum Contact do CRM ("WhatsApp Geral"). */
  contactId: string | null;
  displayName: string;
  phoneNormalized: string;
  whatsappName: string | null;
  lastMessagePreview: string;
  lastMessageDirection: "INBOUND" | "OUTBOUND";
  lastMessageAt: Date;
  unreadCount: number;
  deal: { id: string; name: string } | null;
  ownerId: string;
  ownerName: string;
};

export async function listConversations(organizationId: string, scope: DealScope): Promise<ConversationSummary[]> {
  const threads = await prisma.whatsAppThread.findMany({
    where: { organizationId, ...whatsappScopeWhere(scope) },
    include: {
      contact: { select: { id: true, name: true } },
      instance: { select: { userId: true, user: { select: { id: true, name: true } } } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  // Thread sem nenhuma mensagem ainda (ex.: criada mas o envio falhou logo
  // depois) não é uma conversa de verdade — não aparece na lista.
  const withMessages = threads.filter((t) => t.messages.length > 0);
  if (withMessages.length === 0) return [];

  const threadIds = withMessages.map((t) => t.id);
  const contactIds = withMessages.map((t) => t.contactId).filter((id): id is string => !!id);

  const [unreadCounts, openDeals] = await Promise.all([
    prisma.whatsAppMessage.groupBy({
      by: ["threadId"],
      where: { organizationId, direction: "INBOUND", read: false, threadId: { in: threadIds } },
      _count: { _all: true },
    }),
    contactIds.length
      ? prisma.deal.findMany({
          where: { organizationId, contactId: { in: contactIds }, status: "OPEN" },
          orderBy: { createdAt: "desc" },
          select: { id: true, name: true, contactId: true },
        })
      : Promise.resolve([]),
  ]);

  const unreadByThread = new Map(unreadCounts.map((u) => [u.threadId, u._count._all]));
  const dealByContact = new Map<string, { id: string; name: string }>();
  for (const deal of openDeals) {
    if (!dealByContact.has(deal.contactId)) dealByContact.set(deal.contactId, { id: deal.id, name: deal.name });
  }

  const result: ConversationSummary[] = withMessages.map((thread) => {
    const msg = thread.messages[0];
    return {
      threadId: thread.id,
      contactId: thread.contactId,
      displayName:
        thread.contact?.name ?? thread.whatsappName ?? formatBrazilianPhone(thread.phoneNormalized) ?? thread.phoneNormalized,
      phoneNormalized: thread.phoneNormalized,
      whatsappName: thread.whatsappName,
      lastMessagePreview: msg.body || PREVIEW_FALLBACK[msg.type] || "—",
      lastMessageDirection: msg.direction,
      lastMessageAt: msg.createdAt,
      unreadCount: unreadByThread.get(thread.id) ?? 0,
      deal: thread.contactId ? (dealByContact.get(thread.contactId) ?? null) : null,
      ownerId: thread.instance.userId,
      ownerName: thread.instance.user.name,
    };
  });

  result.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
  return result;
}
