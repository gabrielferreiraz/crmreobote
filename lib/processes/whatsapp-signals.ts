import { prisma } from "@/lib/prisma";

/**
 * Contatos (dentre os informados) com mensagem de WhatsApp inbound não lida —
 * usado no Kanban/relatório de Processos para sinalizar quem mandou mensagem
 * e ainda não teve o chat aberto por ninguém.
 */
export async function getContactsWithUnreadWhatsApp(organizationId: string, contactIds: string[]): Promise<Set<string>> {
  if (contactIds.length === 0) return new Set();

  const threads = await prisma.whatsAppThread.findMany({
    where: { organizationId, contactId: { in: contactIds } },
    select: { id: true, contactId: true },
  });
  if (threads.length === 0) return new Set();

  const unreadGroups = await prisma.whatsAppMessage.groupBy({
    by: ["threadId"],
    where: {
      organizationId,
      direction: "INBOUND",
      read: false,
      threadId: { in: threads.map((t) => t.id) },
    },
    _count: { _all: true },
  });
  const unreadThreadIds = new Set(unreadGroups.map((g) => g.threadId));

  const result = new Set<string>();
  for (const t of threads) {
    if (t.contactId && unreadThreadIds.has(t.id)) result.add(t.contactId);
  }
  return result;
}
