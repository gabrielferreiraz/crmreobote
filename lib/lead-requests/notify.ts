/**
 * Avisos (push) de pedido de lead — achado durante importação de contatos
 * (ver lib/contacts/import-resolve.ts): uma linha duplicada aponta pra um
 * contato de outro consultor ATIVO, que precisa aprovar/recusar (ver
 * app/api/lead-requests). Mesmo espírito de lib/processes/notify.ts — nunca
 * bloqueia a ação principal, sempre chamado com .catch() no call site.
 */

import { sendPushToUser } from "@/lib/push";

export async function notifyLeadRequestCreated(request: {
  contactName: string;
  requesterName: string;
  ownerId: string;
  /** Nome de quem VAI RECEBER o lead se aprovado, só quando é OUTRA pessoa
   * (não quem pediu) — caso do admin/assistente importando planilha em
   * nome de alguém (ver assigneeId em prisma/schema.prisma). Ausente/igual
   * a requesterName = pedido normal, "pra própria carteira". */
  assigneeName?: string | null;
}): Promise<void> {
  const forSomeoneElse = request.assigneeName && request.assigneeName !== request.requesterName;
  await sendPushToUser(request.ownerId, {
    title: "Pedido de lead",
    body: forSomeoneElse
      ? `${request.requesterName} pediu ${request.contactName} para ${request.assigneeName}`
      : `${request.requesterName} pediu ${request.contactName} para a carteira dele`,
    url: "/clientes",
  }).catch((err) => console.error("[lead-requests] falha ao mandar push de pedido", err));
}

/**
 * Avisa quando o dono resolve — aprovado ou recusado, merece resposta
 * (senão o pedido só "some" sem explicação). Vai pra quem VAI FICAR com o
 * lead (assigneeId, se o pedido foi feito em nome de outra pessoa — ver
 * notifyLeadRequestCreated acima) — não necessariamente quem pediu.
 */
export async function notifyLeadRequestResolved(request: {
  contactId: string;
  contactName: string;
  requesterId: string;
  assigneeId?: string | null;
  approved: boolean;
}): Promise<void> {
  await sendPushToUser(request.assigneeId ?? request.requesterId, {
    title: request.approved ? "Lead liberado" : "Pedido de lead recusado",
    body: request.approved
      ? `${request.contactName} agora é seu`
      : `Seu pedido por ${request.contactName} foi recusado`,
    url: request.approved ? `/clientes/${request.contactId}` : "/clientes",
  }).catch((err) => console.error("[lead-requests] falha ao mandar push de resolução", err));
}
