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
}): Promise<void> {
  await sendPushToUser(request.ownerId, {
    title: "Pedido de lead",
    body: `${request.requesterName} pediu ${request.contactName} para a carteira dele`,
    url: "/clientes",
  }).catch((err) => console.error("[lead-requests] falha ao mandar push de pedido", err));
}

/** Avisa quem pediu quando o dono resolve — aprovado ou recusado, os dois merecem resposta (senão o pedido só "some" sem explicação). */
export async function notifyLeadRequestResolved(request: {
  contactId: string;
  contactName: string;
  requesterId: string;
  approved: boolean;
}): Promise<void> {
  await sendPushToUser(request.requesterId, {
    title: request.approved ? "Lead liberado" : "Pedido de lead recusado",
    body: request.approved
      ? `${request.contactName} agora é seu`
      : `Seu pedido por ${request.contactName} foi recusado`,
    url: request.approved ? `/clientes/${request.contactId}` : "/clientes",
  }).catch((err) => console.error("[lead-requests] falha ao mandar push de resolução", err));
}
