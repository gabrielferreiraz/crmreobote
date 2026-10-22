import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { centralLeadsEnabled } from "@/lib/whatsapp/central-config";
import { routeCentralLead } from "@/lib/whatsapp/lead-routing";


/** Dono e gerentes ativos — quem responde pela fila "Sem responsável". */
async function queueManagerIds(organizationId: string): Promise<string[]> {
  const rows = await prisma.organizationUser.findMany({
    where: { organizationId, active: true, role: { in: ["OWNER", "MANAGER"] } },
    select: { userId: true },
  });
  return rows.map((row) => row.userId);
}

/**
 * Mensagem recebida AO VIVO numa instância CENTRAL (Evolution ou Meta) —
 * chamada pelos dois webhooks depois de gravar a mensagem. A mensagem já
 * está salva e a thread já nasceu OPEN (ver getOrCreateThread), então
 * nenhuma falha aqui perde o lead: no pior caso ele fica em "Sem responsável".
 *
 * Push vai para o atendente escolhido; quando ninguém recebeu (fila nova ou
 * erro na distribuição), vai para dono/gerentes — uma vez por entrada na
 * fila, não a cada mensagem.
 */
export async function handleCentralInbound(params: {
  organizationId: string;
  threadId: string;
  messageId: string;
  displayName: string;
  preview: string;
  notify: boolean;
}): Promise<{ contactId: string | null }> {
  const { organizationId, threadId, messageId } = params;
  let assigneeId: string | null = null;
  let alertManagers = false;
  let contactId: string | null = null;

  if (centralLeadsEnabled()) {
    try {
      const routing = await routeCentralLead(organizationId, threadId, messageId);
      assigneeId = routing.assigneeId;
      contactId = routing.contactId;
      alertManagers = routing.newlyQueued;
    } catch (err) {
      console.error(`[wa:central] falha ao distribuir thread=${threadId} — fica em "Sem responsável"`, err);
      alertManagers = true;
    }
  } else {
    // Freio de emergência acionado (CENTRAL_LEADS_ENABLED=false): só garante
    // que a conversa está na fila; nada de rodízio, criação de contato nem aviso.
    const thread = await prisma.whatsAppThread
      .update({ where: { id: threadId }, data: { inboxStatus: "OPEN", closedAt: null }, select: { contactId: true } })
      .catch((err) => {
        console.error(`[wa:central] falha ao reabrir thread=${threadId}`, err);
        return null;
      });
    return { contactId: thread?.contactId ?? null };
  }

  if (params.notify) {
    const payload = { title: params.displayName, body: params.preview, url: `/whatsapp/central?c=${threadId}` };
    if (assigneeId) {
      sendPushToUser(assigneeId, payload).catch((err) =>
        console.error("[wa:central] falha ao enviar push ao atendente", err),
      );
    } else if (alertManagers) {
      const managerIds = await queueManagerIds(organizationId);
      for (const managerId of managerIds) {
        sendPushToUser(managerId, { ...payload, title: `Sem responsável: ${params.displayName}` }).catch((err) =>
          console.error("[wa:central] falha ao avisar gestão da fila", err),
        );
      }
    }
  }

  return { contactId };
}
