/**
 * Aviso automático de WhatsApp antes de uma Reunião — sequência de 1+
 * mensagens (mensagem avulsa digitada, ou um Script existente com delay
 * entre etapas, ver components/meeting-invite-dialog.tsx) programada na
 * criação da tarefa. Mecanismo TOTALMENTE separado do mais antigo em
 * scheduled-whatsapp.ts (aquele é só WHATSAPP, 1 mensagem única, dispara
 * EXATAMENTE no dueAt) — aqui é só MEETING, suporta várias mensagens, e
 * dispara ANTES do dueAt (dueAt - reminderMinutesBefore minutos).
 *
 * Decisão explícita do usuário: manda a sequência INTEIRA, respeitando os
 * delays originais do Script escolhido, mesmo que isso empurre alguma
 * mensagem pra depois do horário da própria reunião num script longo — não
 * corta a sequência no meio por causa disso.
 *
 * Roda no mesmo tick do cron de automações (ver
 * app/api/cron/automations/route.ts), igual sendDueScheduledTaskMessages.
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { sendWhatsAppMessageToContact, WhatsAppSendError } from "@/lib/whatsapp/send";
import { sendPushToUser } from "@/lib/push";
import { renderTemplate, type ScriptStep } from "@/lib/campaigns/spintax";
import { brazilGreeting } from "@/lib/timezone";

export async function sendDueMeetingReminders(): Promise<{ checked: number; sent: number; failed: number }> {
  const organizations = await prisma.organization.findMany({ select: { id: true } });
  const now = new Date();

  let checked = 0;
  let sent = 0;
  let failed = 0;

  for (const org of organizations) {
    const result = await runWithTenant(org.id, async () => {
      const dueTasks = await prisma.task.findMany({
        where: {
          type: "MEETING",
          // reminderNextSendAt só existe pra tarefa com aviso configurado
          // (ver schedule-reminder/route.ts) — não precisa checar
          // reminderSteps à parte.
          reminderNextSendAt: { lte: now },
          reminderSentAt: null,
          reminderFailedAt: null,
          // Finalizar a reunião antes da hora cancela o aviso restante —
          // mesma convenção de scheduledMessageText (sem botão novo só
          // pra isso).
          completedAt: null,
        },
        include: { contact: true, owner: { select: { name: true } } },
      });

      let orgSent = 0;
      let orgFailed = 0;

      for (const task of dueTasks) {
        const steps = (task.reminderSteps as unknown as ScriptStep[] | null) ?? [];
        const stepIndex = task.reminderStepIndex ?? 0;
        const step = steps[stepIndex];

        if (!step) {
          // Não deveria acontecer (índice além do array) — encerra sem
          // marcar falha, só evita reprocessar pra sempre.
          await prisma.task.update({ where: { id: task.id }, data: { reminderSentAt: now } });
          continue;
        }

        if (!task.contact) {
          await prisma.task.update({ where: { id: task.id }, data: { reminderFailedAt: now } });
          orgFailed += 1;
          sendPushToUser(task.ownerId, {
            title: "Aviso de reunião não enviado",
            body: `A tarefa "${task.title}" não tem mais um cliente vinculado.`,
            url: "/agenda",
          }).catch((err) => console.error("[meeting-reminder] falha ao notificar", err));
          continue;
        }

        // Renderizado de novo agora (contato/saudação atuais), não no
        // momento em que foi programado — mesma razão de
        // scheduled-whatsapp.ts: {saudacao} depende de QUANDO manda de
        // verdade, e o nome/cargo/empresa podem ter sido editados desde a
        // criação da tarefa.
        const message = renderTemplate(
          step.text,
          { nome: task.contact.name, cargo: task.contact.jobTitle, empresa: task.contact.company, cidade: task.contact.city, consultor: task.owner.name },
          brazilGreeting(),
        );

        try {
          await sendWhatsAppMessageToContact({
            organizationId: org.id,
            contactId: task.contact.id,
            ownerId: task.ownerId,
            text: message,
          });

          const isLastStep = stepIndex + 1 >= steps.length;
          if (isLastStep) {
            await prisma.task.update({ where: { id: task.id }, data: { reminderSentAt: now } });
          } else {
            await prisma.task.update({
              where: { id: task.id },
              data: {
                reminderStepIndex: stepIndex + 1,
                // delayAfterSec é "espera até a PRÓXIMA depois desta" (ver
                // ScriptStep) — aplicado aqui em cima do envio que acabou
                // de sair, não em cima do reminderNextSendAt antigo.
                reminderNextSendAt: new Date(now.getTime() + Math.max(0, step.delayAfterSec) * 1000),
              },
            });
          }
          orgSent += 1;
        } catch (err) {
          if (err instanceof WhatsAppSendError) {
            await prisma.task.update({ where: { id: task.id }, data: { reminderFailedAt: now } });
            orgFailed += 1;
            sendPushToUser(task.ownerId, {
              title: "Falha ao enviar aviso de reunião",
              body: `Não consegui mandar o aviso pra ${task.contact.name}: ${err.message}`,
              url: "/agenda",
            }).catch((e) => console.error("[meeting-reminder] falha ao notificar", e));
          } else {
            // Erro inesperado (infra/bug) — não marca falha, tenta de novo
            // no próximo tick.
            console.error("[meeting-reminder] erro inesperado ao processar tarefa", task.id, err);
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

/**
 * Aviso PUSH pro PRÓPRIO consultor antes de uma Reunião — irmão mais simples
 * do aviso ao cliente acima: 1 envio só (sem sequência/Script), texto sempre
 * gerado aqui (nunca escrito pelo consultor, ver
 * components/meeting-invite-dialog.tsx). Sem retry: falha de push (endpoint
 * expirado etc.) já é tratada dentro de sendPushToUser, que nunca lança —
 * marca enviado de qualquer jeito, não faz sentido reprocessar pra sempre
 * um lembrete que já passou do horário.
 */
export async function sendDueSelfReminders(): Promise<{ checked: number; sent: number }> {
  const organizations = await prisma.organization.findMany({ select: { id: true } });
  const now = new Date();

  let checked = 0;
  let sent = 0;

  for (const org of organizations) {
    const orgSent = await runWithTenant(org.id, async () => {
      const dueTasks = await prisma.task.findMany({
        where: {
          type: "MEETING",
          selfReminderSendAt: { lte: now },
          selfReminderSentAt: null,
          completedAt: null,
        },
        include: { contact: { select: { name: true } } },
      });

      let count = 0;
      for (const task of dueTasks) {
        const timeLabel = task.dueAt
          ? task.dueAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Campo_Grande" })
          : "";
        await sendPushToUser(task.ownerId, {
          title: "Reunião chegando",
          body: task.contact
            ? `${task.title} com ${task.contact.name}${timeLabel ? ` às ${timeLabel}` : ""}`
            : `${task.title}${timeLabel ? ` às ${timeLabel}` : ""}`,
          url: "/agenda",
        }).catch((err) => console.error("[meeting-reminder] falha ao mandar aviso pro próprio consultor", task.id, err));
        await prisma.task.update({ where: { id: task.id }, data: { selfReminderSentAt: now } });
        count++;
      }
      return { checkedCount: dueTasks.length, sentCount: count };
    });

    checked += orgSent.checkedCount;
    sent += orgSent.sentCount;
  }

  return { checked, sent };
}
