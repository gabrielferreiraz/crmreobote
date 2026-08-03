/**
 * Envio automático de mensagens de WhatsApp programadas numa tarefa (ver
 * Task.scheduledMessageText no schema, preenchido por
 * components/schedule-message-dialog.tsx) — roda no mesmo tick do cron de
 * automações (ver app/api/cron/automations/route.ts), que já bate a cada
 * 1-2min em produção via cron-job.org. Não é uma AutomationRule (aquele
 * motor é regra configurável pelo dono da organização, com condições e
 * dedup próprios); isso aqui é ad-hoc por tarefa, decidido pelo consultor
 * na hora de criar — mesmo loop por organização, mecanismo mais simples.
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { sendWhatsAppMessageToContact, WhatsAppSendError } from "@/lib/whatsapp/send";
import { renderTemplate } from "@/lib/campaigns/spintax";
import { brazilGreeting } from "@/lib/timezone";
import { sendPushToUser } from "@/lib/push";

export async function sendDueScheduledTaskMessages(): Promise<{ checked: number; sent: number; failed: number }> {
  const organizations = await prisma.organization.findMany({ select: { id: true } });
  const now = new Date();

  let checked = 0;
  let sent = 0;
  let failed = 0;

  for (const org of organizations) {
    const result = await runWithTenant(org.id, async () => {
      const dueTasks = await prisma.task.findMany({
        where: {
          type: "WHATSAPP",
          scheduledMessageText: { not: null },
          scheduledMessageSentAt: null,
          scheduledMessageFailedAt: null,
          // Finalizar a tarefa antes da hora é a forma (já existente,
          // reaproveitada) de cancelar o envio — sem botão novo só pra isso.
          completedAt: null,
          dueAt: { lte: now },
        },
        include: { contact: true, owner: { select: { id: true, name: true } } },
      });

      let orgSent = 0;
      let orgFailed = 0;

      for (const task of dueTasks) {
        if (!task.contact) {
          // Contato desvinculado depois de programada a mensagem (raro) —
          // sem pra quem mandar, é falha permanente igual às outras.
          await prisma.task.update({ where: { id: task.id }, data: { scheduledMessageFailedAt: new Date() } });
          orgFailed += 1;
          sendPushToUser(task.ownerId, {
            title: "Mensagem programada não enviada",
            body: `A tarefa "${task.title}" não tem mais um cliente vinculado.`,
            url: "/agenda",
          }).catch((err) => console.error("[scheduled-whatsapp] falha ao notificar", err));
          continue;
        }

        const message = renderTemplate(
          task.scheduledMessageText!,
          {
            nome: task.contact.name,
            cargo: task.contact.jobTitle,
            empresa: task.contact.company,
            cidade: task.contact.city,
            consultor: task.owner.name,
          },
          brazilGreeting(),
        );

        try {
          await sendWhatsAppMessageToContact({
            organizationId: org.id,
            contactId: task.contact.id,
            ownerId: task.ownerId,
            text: message,
          });
          await prisma.task.update({ where: { id: task.id }, data: { scheduledMessageSentAt: new Date() } });
          orgSent += 1;
        } catch (err) {
          if (err instanceof WhatsAppSendError) {
            // Falha de NEGÓCIO (WhatsApp desconectado, contato sem número
            // válido, etc.) — sem retry automático, por decisão de produto:
            // marca de vez e avisa o consultor uma única vez.
            await prisma.task.update({ where: { id: task.id }, data: { scheduledMessageFailedAt: new Date() } });
            orgFailed += 1;
            sendPushToUser(task.ownerId, {
              title: "Falha ao enviar mensagem programada",
              body: `Não consegui mandar a mensagem pra ${task.contact.name}: ${err.message}`,
              url: "/agenda",
            }).catch((e) => console.error("[scheduled-whatsapp] falha ao notificar", e));
          } else {
            // Erro inesperado (bug/infra, não uma falha de envio de
            // verdade) — de propósito NÃO marca failedAt, pra tentar de
            // novo no próximo tick em vez de desistir de um erro
            // transitório. "Sem retry" é sobre falha de envio, não sobre
            // isso.
            console.error("[scheduled-whatsapp] erro inesperado ao processar tarefa", task.id, err);
          }
        }
      }

      return { checked: dueTasks.length, sent: orgSent, failed: orgFailed };
    });

    checked += result.checked;
    sent += result.sent;
    failed += result.failed;
  }

  return { checked, sent, failed };
}
