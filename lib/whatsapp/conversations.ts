/**
 * Monta a lista de conversas pra alimentar a tela de Conversas — o inbox
 * unificado de WhatsApp (abas "CRM"/"Geral", ver conversations-view.tsx).
 * Usado tanto na renderização inicial da página quanto na rota que o
 * polling do cliente chama, pra não duplicar a query nos dois lugares.
 */

import { prisma } from "@/lib/prisma";
import { whatsappThreadScopeWhere, type DealScope } from "@/lib/team-scope";
import { formatBrazilianPhone } from "@/lib/phone-normalize";

const PREVIEW_FALLBACK: Record<string, string> = {
  IMAGE: "📷 Imagem",
  AUDIO: "🎵 Áudio",
  CONTACT: "👤 Contato",
  PIX: "💰 Pix",
  STICKER: "🧩 Figurinha",
  CALL: "📞 Chamada",
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
  /** Cacheada em WhatsAppThread (ver app/api/whatsapp/threads/[threadId]/photo) — null até a conversa ser aberta ao menos uma vez. */
  profilePicUrl: string | null;
};

/**
 * Quantas conversas a lista (e o polling de 5s que a mantém atualizada, ver
 * conversations-view.tsx) traz por padrão — é um inbox de "conversas
 * recentes", não um arquivo histórico completo; ninguém precisa ver de
 * relance um lead frio de anos atrás que nunca mais respondeu. Bem generoso
 * pra escala de equipe real (a organização inteira, não por vendedor).
 */
const DEFAULT_LIMIT = 300;

export async function listConversations(
  organizationId: string,
  scope: DealScope,
  limit: number = DEFAULT_LIMIT,
): Promise<ConversationSummary[]> {
  const threads = await prisma.whatsAppThread.findMany({
    where: {
      organizationId,
      ...whatsappThreadScopeWhere(scope),
      // Thread sem nenhuma mensagem ainda (ex.: criada mas o envio falhou logo
      // depois) não é uma conversa de verdade — lastMessageAt só é gravado
      // depois da 1ª mensagem (ver touchThreadLastMessage), então esse filtro
      // já exclui ela. Thread órfã (instanceId null — instância apagada de
      // verdade, dono desativado) também não entra: é histórico arquivado,
      // vive no backup de mensagens (Configurações > Usuários), não no inbox
      // de conversas ativas.
      lastMessageAt: { not: null },
      instanceId: { not: null },
    },
    // Ordena e já limita no Postgres (índice organizationId+lastMessageAt) —
    // antes buscava TODA thread da organização, com a última mensagem de
    // cada uma via join, só pra ordenar isso em JavaScript depois. Rodava a
    // cada 5s (polling), então esse era o tipo de custo que cresce sozinho
    // com o histórico total, não com o quanto está de fato ativo.
    orderBy: { lastMessageAt: "desc" },
    take: limit,
    include: {
      contact: { select: { id: true, name: true } },
      instance: { select: { userId: true, user: { select: { id: true, name: true } } } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  // Checagem defensiva — na prática lastMessageAt garante isso, mas não
  // custa nada continuar filtrando caso o cache fique dessincronizado.
  const withMessages = threads.filter((t) => t.messages.length > 0 && t.instance);
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
          select: { id: true, name: true, contactId: true, ownerId: true, owner: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);

  const unreadByThread = new Map(unreadCounts.map((u) => [u.threadId, u._count._all]));
  const dealByContact = new Map<string, { id: string; name: string; ownerId: string; ownerName: string }>();
  for (const deal of openDeals) {
    if (!dealByContact.has(deal.contactId)) {
      dealByContact.set(deal.contactId, { id: deal.id, name: deal.name, ownerId: deal.ownerId, ownerName: deal.owner.name });
    }
  }

  const result: ConversationSummary[] = withMessages.map((thread) => {
    const msg = thread.messages[0];
    const deal = thread.contactId ? dealByContact.get(thread.contactId) : undefined;
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
      deal: deal ? { id: deal.id, name: deal.name } : null,
      // "Responsável" é quem é dono do NEGÓCIO vinculado, quando existe um —
      // pode ser diferente de quem tem esse WhatsApp conectado (o dono
      // conecta o número, mas atribui o lead pra outro vendedor cuidar). Sem
      // negócio vinculado (WhatsApp Geral), cai no dono da instância mesmo,
      // que é a única informação de "responsável" que existe nesse caso.
      ownerId: deal?.ownerId ?? thread.instance?.userId ?? "",
      ownerName: deal?.ownerName ?? thread.instance?.user.name ?? "",
      profilePicUrl: thread.profilePicUrl,
    };
  });

  result.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
  return result;
}

/**
 * Quantas conversas (não mensagens) têm pelo menos uma mensagem recebida
 * não lida — usado pelo card "Exige ação" do Início (ver
 * new-design-for-claude/README.md). Mesmo escopo/critério de "não lida" que
 * listConversations já usa acima (direction INBOUND, read false), só que
 * contando threads em vez de somar mensagens.
 */
export async function countUnreadThreads(organizationId: string, scope: DealScope): Promise<number> {
  return prisma.whatsAppThread.count({
    where: {
      organizationId,
      ...whatsappThreadScopeWhere(scope),
      instanceId: { not: null },
      messages: { some: { direction: "INBOUND", read: false } },
    },
  });
}
