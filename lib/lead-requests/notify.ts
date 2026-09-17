/**
 * Avisos (push + e-mail) de pedido de lead — achado durante importação de
 * contatos (ver lib/contacts/import-resolve.ts): uma linha duplicada aponta
 * pra um contato de outro consultor ATIVO, que precisa aprovar/recusar (ver
 * app/api/lead-requests). Mesmo espírito de lib/processes/notify.ts — nunca
 * bloqueia a ação principal, sempre chamado com .catch() no call site.
 *
 * E-mail sempre ligado (sem passar por isEmailNotificationEnabled/
 * Organization.emailNotificationSettings) de propósito — aquele toggle é
 * pra alerta de INFRAESTRUTURA que o dono da conta liga/desliga pra
 * organização inteira (WhatsApp caiu, senha trocada); isto aqui é um pedido
 * direto entre duas pessoas que precisa de uma decisão (aprovar/recusar),
 * mais perto de "alguém te chamou" do que de um alerta do sistema.
 */

import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/security/html-escape";

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
  const forSomeoneElse = !!(request.assigneeName && request.assigneeName !== request.requesterName);
  const body = forSomeoneElse
    ? `${request.requesterName} pediu ${request.contactName} para ${request.assigneeName}`
    : `${request.requesterName} pediu ${request.contactName} para a carteira dele`;

  await Promise.all([
    sendPushToUser(request.ownerId, { title: "Pedido de lead", body, url: "/clientes" }).catch((err) =>
      console.error("[lead-requests] falha ao mandar push de pedido", err),
    ),
    sendLeadRequestCreatedEmail({ ...request, forSomeoneElse, body }).catch((err) =>
      console.error("[lead-requests] falha ao mandar e-mail de pedido", err),
    ),
  ]);
}

async function sendLeadRequestCreatedEmail(request: {
  contactName: string;
  ownerId: string;
  forSomeoneElse: boolean;
  assigneeName?: string | null;
  body: string;
}) {
  const owner = await prisma.user.findUnique({ where: { id: request.ownerId }, select: { email: true } });
  if (!owner?.email) return; // usuário sem e-mail cadastrado — só o push mesmo

  const appUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? "";
  // request.body já é a mesma frase do push, só precisa escapar antes de
  // virar HTML (nomes vêm de User.name/Contact.name, editáveis por quem usa
  // o CRM — sem isso, dava pra injetar `<a href="...">` no próprio nome).
  const safeBody = escapeHtml(request.body);

  const html = `
    <p>${safeBody}.</p>
    <p>Entre no CRM pra aprovar ou recusar — o pedido fica pendente até alguém decidir.</p>
    ${appUrl ? `<p><a href="${appUrl}/clientes">Ver pedido</a></p>` : ""}
  `;

  const result = await sendEmail({ to: owner.email, subject: `👤 Pedido de lead: ${request.contactName}`, html });
  if (!result.ok) console.error(`[lead-requests] falha ao enviar e-mail de pedido: ${result.error}`);
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
