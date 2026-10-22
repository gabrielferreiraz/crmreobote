/**
 * Monta a lista de conversas pra alimentar a tela de Conversas — o inbox
 * unificado de WhatsApp (abas "CRM"/"Geral", ver conversations-view.tsx).
 * Usado tanto na renderização inicial da página quanto na rota que o
 * polling do cliente chama, pra não duplicar a query nos dois lugares.
 */

import { prisma } from "@/lib/prisma";
import { whatsappThreadScopeWhere, type DealScope } from "@/lib/team-scope";
import { formatBrazilianPhone } from "@/lib/phone-normalize";
import { messagePreview } from "@/lib/whatsapp/message-preview";

export type ConversationSummary = {
  threadId: string;
  /** null = ainda não vinculada a nenhum Contact do CRM ("WhatsApp Geral"). */
  contactId: string | null;
  displayName: string;
  phoneNormalized: string;
  whatsappName: string | null;
  lastMessagePreview: string;
  lastMessageDirection: "INBOUND" | "OUTBOUND";
  /** Quem mandou a última mensagem, quando ela foi ENVIADA (OUTBOUND) — pra
   * prévia dizer "Você:" só pra quem mandou de fato, e o nome de quem mandou
   * pra quem está vendo a conversa de outra pessoa (dono/gerente). */
  lastMessageFrom: { id: string; name: string } | null;
  lastMessageAt: Date;
  unreadCount: number;
  deal: { id: string; name: string } | null;
  ownerId: string;
  ownerName: string;
  /** userIds de quem já MANDOU alguma mensagem OUTBOUND nesta conversa (ver
   * comentário em listConversations abaixo) — diferente de ownerId (quem é
   * responsável pelo negócio vinculado, não necessariamente quem falou com o
   * lead). Usado pelo filtro "Você"/nome de consultor em conversations-view:
   * filtrar por responsabilidade misturava conversa de quem nunca trocou uma
   * mensagem sequer com quem realmente atendeu o lead. */
  senderIds: string[];
  /** Cacheada em WhatsAppThread (ver app/api/whatsapp/threads/[threadId]/photo) — null até a conversa ser aberta ao menos uma vez. */
  profilePicUrl: string | null;
};

/**
 * Quantas conversas a lista (e a atualização ao vivo + poll de segurança que
 * a mantém em dia, ver use-conversations-list.ts) traz por padrão — é um inbox de "conversas
 * recentes", não um arquivo histórico completo; ninguém precisa ver de
 * relance um lead frio de anos atrás que nunca mais respondeu. Bem generoso
 * pra escala de equipe real (a organização inteira, não por vendedor).
 */
const DEFAULT_LIMIT = 300;
const SENDER_CACHE_MAX = 5_000;
type SenderCacheEntry = {
  version: string;
  lastMessageAtMs: number;
  senderIds: string[];
};
const globalForConversationCache = globalThis as unknown as {
  whatsAppSenderCache?: Map<string, SenderCacheEntry>;
};
const senderCache = globalForConversationCache.whatsAppSenderCache ?? new Map<string, SenderCacheEntry>();
globalForConversationCache.whatsAppSenderCache = senderCache;

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
      // Só conversas pessoais: inboxStatus preenchido = Central (tela própria).
      // Coluna da própria thread, sem JOIN — esta lista roda em polling.
      inboxStatus: null,
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
      instance: { select: { personalOwnerId: true, personalOwner: { select: { id: true, name: true } } } },
      // Só o que a prévia usa — sem isso vinham TODAS as colunas da última
      // mensagem, inclusive rawPayload (o JSON bruto do WhatsApp), em 300
      // conversas, a cada atualização da lista.
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, body: true, type: true, direction: true, createdAt: true, sentByUserId: true },
      },
    },
  });

  // Checagem defensiva — na prática lastMessageAt garante isso, mas não
  // custa nada continuar filtrando caso o cache fique dessincronizado.
  const withMessages = threads.filter((t) => t.messages.length > 0 && t.instance);
  if (withMessages.length === 0) return [];

  const threadIds = withMessages.map((t) => t.id);
  const contactIds = withMessages.map((t) => t.contactId).filter((id): id is string => !!id);

  const instanceUserIdByThread = new Map(
    withMessages.flatMap((thread) =>
      thread.instance?.personalOwnerId ? [[thread.id, thread.instance.personalOwnerId] as const] : [],
    ),
  );

  const sendersByThread = new Map<string, Set<string>>();
  const coldSenderThreads = new Set<string>();
  const changedSenderThreads = new Set<string>();
  let senderDeltaSinceMs = Number.POSITIVE_INFINITY;
  for (const thread of withMessages) {
    const lastMessageAtMs = (thread.lastMessageAt ?? thread.messages[0].createdAt).getTime();
    const version = `${lastMessageAtMs}:${thread.messages[0].id}`;
    const cached = senderCache.get(thread.id);
    if (cached) {
      sendersByThread.set(thread.id, new Set(cached.senderIds));
      if (cached.version !== version) {
        changedSenderThreads.add(thread.id);
        senderDeltaSinceMs = Math.min(
          senderDeltaSinceMs,
          Number.isFinite(cached.lastMessageAtMs) ? cached.lastMessageAtMs : 0,
        );
      }
    } else {
      coldSenderThreads.add(thread.id);
    }
  }

  // Uma thread ativa muda de `lastMessageAt` a cada mensagem. Antes isso
  // invalidava o cache e reagrupava TODO o historico dela repetidamente.
  // Threads ja conhecidas consultam apenas o intervalo novo; so a primeira
  // carga de cada thread precisa olhar o historico completo.
  const outboundSendersPromise = Promise.all([
    coldSenderThreads.size
      ? prisma.whatsAppMessage.groupBy({
          by: ["threadId", "sentByUserId"],
          where: { organizationId, direction: "OUTBOUND", threadId: { in: Array.from(coldSenderThreads) } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    changedSenderThreads.size
      ? prisma.whatsAppMessage.groupBy({
          by: ["threadId", "sentByUserId"],
          where: {
            organizationId,
            direction: "OUTBOUND",
            threadId: { in: Array.from(changedSenderThreads) },
            createdAt: { gte: new Date(senderDeltaSinceMs) },
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]).then(([coldRows, deltaRows]) => [...coldRows, ...deltaRows]);

  const [unreadCounts, openDeals, outboundSenders] = await Promise.all([
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
    // Distinct (threadId, sentByUserId) entre as mensagens OUTBOUND destas
    // threads — dá quem de fato mandou mensagem em cada conversa, pra
    // alimentar o filtro "Você"/nome de consultor (ver senderIds acima).
    // sentByUserId nulo é o caso normal (dono da instância mandando pela
    // própria) — resolvido abaixo via instanceUserIdByThread; só vira "quem
    // mandou" de verdade quando preenchido (override, ver schema). Escopado a
    // `threadIds` (só as ~300 conversas já selecionadas, não o histórico
    // OUTBOUND da organização inteira) — mesmo escopo que unreadCounts acima.
    outboundSendersPromise,
  ]);

  const unreadByThread = new Map(unreadCounts.map((u) => [u.threadId, u._count._all]));
  for (const row of outboundSenders) {
    const effectiveSenderId = row.sentByUserId ?? instanceUserIdByThread.get(row.threadId);
    if (!effectiveSenderId) continue;
    const set = sendersByThread.get(row.threadId);
    if (set) set.add(effectiveSenderId);
    else sendersByThread.set(row.threadId, new Set([effectiveSenderId]));
  }
  for (const thread of withMessages) {
    if (!coldSenderThreads.has(thread.id) && !changedSenderThreads.has(thread.id)) continue;
    if (senderCache.size >= SENDER_CACHE_MAX) {
      const oldestKey = senderCache.keys().next().value as string | undefined;
      if (oldestKey) senderCache.delete(oldestKey);
    }
    const lastMessageAtMs = (thread.lastMessageAt ?? thread.messages[0].createdAt).getTime();
    senderCache.set(thread.id, {
      version: `${lastMessageAtMs}:${thread.messages[0].id}`,
      lastMessageAtMs,
      senderIds: Array.from(sendersByThread.get(thread.id) ?? []),
    });
  }
  // Nome de quem mandou a última mensagem quando NÃO foi o dono do número
  // (ex.: gestor mandando pela conversa de um consultor). Envio pelo CRM grava
  // sentByUserId sempre, então quando é o próprio dono o nome já está em mãos;
  // só busca os outros.
  const overrideSenderIds = Array.from(
    new Set(
      withMessages.flatMap((t) => {
        const m = t.messages[0];
        return m.direction === "OUTBOUND" && m.sentByUserId && m.sentByUserId !== t.instance?.personalOwnerId ? [m.sentByUserId] : [];
      }),
    ),
  );
  const overrideSenderNames = new Map(
    overrideSenderIds.length > 0
      ? (await prisma.user.findMany({ where: { id: { in: overrideSenderIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])
      : [],
  );

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
      // customName entra ANTES de whatsappName, de propósito: é o apelido
      // manual (ver rename em app/api/whatsapp/threads/[threadId]/rename)
      // que existe justamente pra sobrepor o que a Evolution manda — se
      // caísse depois, um pushName novo chegando (ver getOrCreateThread em
      // lib/whatsapp/threads.ts) nunca teria efeito mesmo assim, mas contact?.name
      // continua tendo prioridade máxima: contato vinculado é a identidade
      // "oficial" no CRM inteiro, não só um apelido de conversa.
      displayName:
        thread.contact?.name ??
        thread.customName ??
        thread.whatsappName ??
        formatBrazilianPhone(thread.phoneNormalized) ??
        thread.phoneNormalized,
      phoneNormalized: thread.phoneNormalized,
      whatsappName: thread.whatsappName,
      lastMessagePreview: messagePreview(msg.body, msg.type, "—"),
      lastMessageDirection: msg.direction,
      lastMessageFrom:
        msg.direction !== "OUTBOUND"
          ? null
          : msg.sentByUserId && msg.sentByUserId !== thread.instance?.personalOwnerId
            ? { id: msg.sentByUserId, name: overrideSenderNames.get(msg.sentByUserId) ?? "" }
            : thread.instance?.personalOwner
              ? { id: thread.instance.personalOwner.id, name: thread.instance.personalOwner.name }
              : null,
      lastMessageAt: msg.createdAt,
      unreadCount: unreadByThread.get(thread.id) ?? 0,
      deal: deal ? { id: deal.id, name: deal.name } : null,
      // "Responsável" é quem é dono do NEGÓCIO vinculado, quando existe um —
      // pode ser diferente de quem tem esse WhatsApp conectado (o dono
      // conecta o número, mas atribui o lead pra outro vendedor cuidar). Sem
      // negócio vinculado (WhatsApp Geral), cai no dono da instância mesmo,
      // que é a única informação de "responsável" que existe nesse caso.
      ownerId: deal?.ownerId ?? thread.instance?.personalOwnerId ?? "",
      ownerName: deal?.ownerName ?? thread.instance?.personalOwner?.name ?? "",
      senderIds: Array.from(sendersByThread.get(thread.id) ?? []),
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
export async function countUnreadThreads(
  organizationId: string,
  scope: DealScope,
  userId?: string,
): Promise<number> {
  return prisma.whatsAppThread.count({
    where: {
      organizationId,
      instanceId: { not: null },
      messages: { some: { direction: "INBOUND", read: false } },
      // Pessoais pelo escopo de sempre + atendimentos da Central que são de
      // quem está vendo (a fila "Sem responsável" tem badge próprio na Central).
      OR: [
        { inboxStatus: null, ...whatsappThreadScopeWhere(scope) },
        ...(userId ? [{ inboxStatus: "OPEN" as const, assigneeId: userId }] : []),
      ],
    },
  });
}
