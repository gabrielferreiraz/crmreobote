/**
 * Motor de disparo das campanhas de prospecção — chamado pelo cron
 * (app/api/cron/campaigns/route.ts). Manda no máximo UMA mensagem por
 * campanha ativa a cada execução, respeitando janela de horário, teto
 * diário e o delay configurado — não é um worker próprio com timers em
 * memória, é reavaliado do zero a cada tick, então sobrevive a reinício de
 * processo sem perder estado.
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { brazilHour, brazilWeekday, brazilStartOfDay, brazilGreeting } from "@/lib/timezone";
import { getOrCreateThread } from "@/lib/whatsapp/threads";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { normalizePhoneNumber } from "@/lib/phone-normalize";
import { renderTemplate, pickWeightedTemplate, type WeightedTemplate } from "@/lib/campaigns/spintax";
import type { $Enums } from "@/app/generated/prisma/client";

type CampaignRow = {
  id: string;
  instanceId: string;
  messageTemplates: unknown;
  delayMinSec: number;
  delayMaxSec: number;
  dailyCap: number | null;
  allowedWeekdays: number[];
  windowStartHour: number;
  windowEndHour: number;
};

function isWithinSchedule(campaign: CampaignRow): boolean {
  const now = new Date();
  if (!campaign.allowedWeekdays.includes(brazilWeekday(now))) return false;
  const hour = brazilHour(now);
  return hour >= campaign.windowStartHour && hour < campaign.windowEndHour;
}

async function dailyCapReached(campaign: CampaignRow): Promise<boolean> {
  if (campaign.dailyCap == null) return false;
  const count = await prisma.campaignRecipient.count({
    where: { campaignId: campaign.id, status: "SENT", sentAt: { gte: brazilStartOfDay() } },
  });
  return count >= campaign.dailyCap;
}

/**
 * Sempre exige pelo menos delayMinSec desde o último envio. Passado o
 * mínimo, sorteia um novo limiar dentro da faixa a cada checagem em vez de
 * disparar sempre no primeiro tick após o mínimo — assim o intervalo real
 * varia dentro da faixa configurada em vez de virar um padrão fixo.
 */
async function shouldSendNow(campaign: CampaignRow): Promise<boolean> {
  const last = await prisma.campaignRecipient.findFirst({
    where: { campaignId: campaign.id, status: "SENT" },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true },
  });
  if (!last?.sentAt) return true;

  const elapsedSec = (Date.now() - last.sentAt.getTime()) / 1000;
  if (elapsedSec < campaign.delayMinSec) return false;

  const threshold = campaign.delayMinSec + Math.random() * (campaign.delayMaxSec - campaign.delayMinSec);
  return elapsedSec >= threshold;
}

/** Depois de 5 falhas seguidas (mesma sequência em que os destinatários são processados), pausa sozinha em vez de continuar insistindo. */
async function pauseIfFailing(campaignId: string): Promise<void> {
  const recent = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: { in: ["SENT", "FAILED"] } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  if (recent.length === 5 && recent.every((r) => r.status === "FAILED")) {
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: "PAUSED" } });
  }
}

export async function runCampaigns(): Promise<{ checked: number; sent: number; failed: number }> {
  // Organization não tem RLS — listar aqui é seguro; cada uma é processada
  // depois já com o tenant certo (mesmo padrão de runAutomations/health-check).
  const organizations = await prisma.organization.findMany({ select: { id: true } });

  let checked = 0;
  let sent = 0;
  let failed = 0;

  for (const org of organizations) {
    await runWithTenant(org.id, async () => {
      const campaigns = await prisma.campaign.findMany({ where: { status: "RUNNING" } });

      for (const campaign of campaigns) {
        checked += 1;
        if (!isWithinSchedule(campaign)) continue;
        if (await dailyCapReached(campaign)) continue;
        if (!(await shouldSendNow(campaign))) continue;

        const recipient = await prisma.campaignRecipient.findFirst({
          where: { campaignId: campaign.id, status: "PENDING" },
          orderBy: { createdAt: "asc" },
          include: { contact: true },
        });

        if (!recipient) {
          await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "DONE" } });
          continue;
        }

        const phoneNormalized = normalizePhoneNumber(recipient.contact.whatsapp || recipient.contact.phone);
        if (!phoneNormalized) {
          await prisma.campaignRecipient.update({
            where: { id: recipient.id },
            data: { status: "SKIPPED", error: "Contato sem WhatsApp/celular cadastrado" },
          });
          continue;
        }

        try {
          const templates = campaign.messageTemplates as unknown as WeightedTemplate[];
          const chosen = pickWeightedTemplate(templates);
          const text = renderTemplate(
            chosen.text,
            { nome: recipient.contact.name, cargo: recipient.contact.jobTitle },
            brazilGreeting(),
          );

          const thread = await getOrCreateThread({
            organizationId: org.id,
            instanceId: campaign.instanceId,
            phoneNormalized,
          });
          await sendWhatsAppMessage({ organizationId: org.id, threadId: thread.id, text });

          await prisma.campaignRecipient.update({
            where: { id: recipient.id },
            data: { status: "SENT", sentAt: new Date(), threadId: thread.id },
          });
          sent += 1;
        } catch (err) {
          await prisma.campaignRecipient.update({
            where: { id: recipient.id },
            data: {
              status: "FAILED" as $Enums.CampaignRecipientStatus,
              error: err instanceof Error ? err.message : String(err),
            },
          });
          failed += 1;
          await pauseIfFailing(campaign.id);
        }
      }
    });
  }

  return { checked, sent, failed };
}
