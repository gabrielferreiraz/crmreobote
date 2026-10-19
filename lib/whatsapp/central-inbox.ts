import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { canReadCentralThread, centralAssigneeIds, type CentralAccess } from "@/lib/whatsapp/central-access";

export type CentralInboxTab = "mine" | "team" | "unassigned" | "closed";

function tabWhere(tab: CentralInboxTab, access: CentralAccess): Prisma.WhatsAppThreadWhereInput {
  const visibleIds = centralAssigneeIds(access);

  if (tab === "mine") return { inboxStatus: "OPEN", assigneeId: access.userId };
  if (tab === "unassigned") {
    return access.canManageQueue ? { inboxStatus: "OPEN", assigneeId: null } : { id: "__forbidden__" };
  }
  if (tab === "team") {
    if (!access.canManageQueue) return { id: "__forbidden__" };
    return {
      inboxStatus: "OPEN",
      assigneeId: visibleIds === null
        ? { not: access.userId }
        : { in: visibleIds.filter((id) => id !== access.userId) },
    };
  }
  return {
    inboxStatus: "CLOSED",
    ...(visibleIds === null ? {} : { assigneeId: { in: visibleIds } }),
  };
}

/** Badges das abas: atendimentos meus com mensagem não lida e tamanho da fila. */
export async function countCentralInbox(organizationId: string, access: CentralAccess) {
  const unread = { messages: { some: { direction: "INBOUND" as const, read: false } } };
  const [mine, unassigned] = await Promise.all([
    prisma.whatsAppThread.count({
      where: { organizationId, inboxStatus: "OPEN", assigneeId: access.userId, ...unread },
    }),
    access.canManageQueue
      ? prisma.whatsAppThread.count({ where: { organizationId, inboxStatus: "OPEN", assigneeId: null } })
      : Promise.resolve(0),
  ]);
  return { mine, unassigned };
}

const ITEM_SELECT = {
  id: true,
  phoneNormalized: true,
  whatsappName: true,
  customName: true,
  profilePicUrl: true,
  lastMessageAt: true,
  inboxStatus: true,
  assigneeId: true,
  assignmentSource: true,
  assignedAt: true,
  contact: {
    select: {
      id: true,
      name: true,
      jobTitle: true,
      responsavelId: true,
      responsavel: { select: { id: true, name: true } },
    },
  },
  assignee: { select: { id: true, name: true, image: true } },
  messages: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { id: true, body: true, type: true, direction: true, read: true, createdAt: true },
  },
  _count: { select: { messages: { where: { direction: "INBOUND" as const, read: false } } } },
} satisfies Prisma.WhatsAppThreadSelect;

type ItemRow = Prisma.WhatsAppThreadGetPayload<{ select: typeof ITEM_SELECT }>;

function toItem(thread: ItemRow) {
  return {
    id: thread.id,
    displayName: thread.contact?.name || thread.customName || thread.whatsappName || thread.phoneNormalized,
    phoneNormalized: thread.phoneNormalized,
    profilePicUrl: thread.profilePicUrl,
    lastMessageAt: thread.lastMessageAt,
    status: thread.inboxStatus,
    assignmentSource: thread.assignmentSource,
    assignedAt: thread.assignedAt,
    assignee: thread.assignee,
    unreadCount: thread._count.messages,
    lastMessage: thread.messages[0] ?? null,
    contact: thread.contact
      ? {
          id: thread.contact.id,
          name: thread.contact.name,
          // Cargo vazio = lead ainda precisa ser qualificado (Em Análise/Quente exigem).
          missingJobTitle: !thread.contact.jobTitle?.trim(),
          responsible: thread.contact.responsavel,
          ownershipBlocked: Boolean(
            thread.assigneeId &&
            thread.contact.responsavelId &&
            thread.assigneeId !== thread.contact.responsavelId,
          ),
        }
      : null,
  };
}

export type CentralInboxItem = ReturnType<typeof toItem>;

export async function listCentralInbox(params: {
  organizationId: string;
  access: CentralAccess;
  tab: CentralInboxTab;
  search?: string;
  take?: number;
}): Promise<CentralInboxItem[]> {
  const search = params.search?.trim();
  // Número digitado com máscara ("(67) 9 9999-...") busca pelos dígitos.
  const digits = search?.replace(/\D/g, "") ?? "";
  const where: Prisma.WhatsAppThreadWhereInput = {
    organizationId: params.organizationId,
    inboxStatus: { not: null },
    ...tabWhere(params.tab, params.access),
    ...(search
      ? {
          OR: [
            { customName: { contains: search, mode: "insensitive" } },
            { whatsappName: { contains: search, mode: "insensitive" } },
            { contact: { name: { contains: search, mode: "insensitive" } } },
            ...(digits.length >= 4 ? [{ phoneNormalized: { contains: digits } }] : []),
          ],
        }
      : {}),
  };

  const rows = await prisma.whatsAppThread.findMany({
    where,
    orderBy: { lastMessageAt: "desc" },
    take: Math.min(Math.max(params.take ?? 50, 1), 100),
    select: ITEM_SELECT,
  });
  return rows.map(toItem);
}

/**
 * Uma conversa só (a que está aberta na tela, ou a do link do push), mesmo
 * que tenha saído da aba atual — ex.: outra pessoa encerrou/transferiu. Sem
 * isso o painel ficava mostrando um estado velho. Respeita a mesma regra de
 * leitura da lista.
 */
export async function getCentralInboxItem(
  organizationId: string,
  access: CentralAccess,
  threadId: string,
): Promise<CentralInboxItem | null> {
  const row = await prisma.whatsAppThread.findFirst({
    where: { id: threadId, organizationId, inboxStatus: { not: null } },
    select: ITEM_SELECT,
  });
  if (!row || !canReadCentralThread(access, { assigneeId: row.assigneeId, inboxStatus: row.inboxStatus })) return null;
  return toItem(row);
}
