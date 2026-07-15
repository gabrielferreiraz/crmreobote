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
import { renderSteps, pickWeighted, type WeightedScript } from "@/lib/campaigns/spintax";
import type { $Enums, Contact } from "@/app/generated/prisma/client";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type CampaignRow = {
  id: string;
  instanceId: string;
  messageTemplates: unknown;
  followUpEnabled: boolean;
  followUpDelayHours: number;
  followUpTemplates: unknown;
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
 * Sempre exige pelo menos delayMinSec desde o último envio (inicial ou de
 * reenvio — os dois usam o mesmo número, então o throttle vale pros dois).
 * Passado o mínimo, sorteia um novo limiar dentro da faixa a cada checagem
 * em vez de disparar sempre no primeiro tick após o mínimo — assim o
 * intervalo real varia dentro da faixa configurada em vez de virar um
 * padrão fixo.
 */
async function shouldSendNow(campaign: CampaignRow): Promise<boolean> {
  // Precisa do MAIOR timestamp entre os dois tipos de envio — um único
  // orderBy composto (sentAt, followUpSentAt) ordenaria primeiro por sentAt
  // inteiro e só usaria followUpSentAt como desempate, o que erra o "último
  // evento de verdade" sempre que o reenvio mais recente pertence a um
  // destinatário cujo envio inicial é mais antigo que o de outro.
  const [lastSent, lastFollowUp] = await Promise.all([
    prisma.campaignRecipient.findFirst({
      where: { campaignId: campaign.id, status: "SENT" },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    }),
    prisma.campaignRecipient.findFirst({
      where: { campaignId: campaign.id, followUpSentAt: { not: null } },
      orderBy: { followUpSentAt: "desc" },
      select: { followUpSentAt: true },
    }),
  ]);
  const candidates = [lastSent?.sentAt, lastFollowUp?.followUpSentAt].filter((d): d is Date => !!d);
  if (candidates.length === 0) return true;
  const lastAt = new Date(Math.max(...candidates.map((d) => d.getTime())));

  const elapsedSec = (Date.now() - lastAt.getTime()) / 1000;
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

/** Só entra na fila de reenvio quem foi enviado com sucesso, nunca respondeu, nunca teve reenvio tentado e já passou o prazo configurado. */
async function findFollowUpCandidate(campaign: CampaignRow) {
  const cutoff = new Date(Date.now() - campaign.followUpDelayHours * 60 * 60 * 1000);
  return prisma.campaignRecipient.findFirst({
    where: {
      campaignId: campaign.id,
      status: "SENT",
      repliedAt: null,
      followUpSentAt: null,
      sentAt: { lte: cutoff },
    },
    orderBy: { sentAt: "asc" },
    include: { contact: true },
  });
}

/** Reenvio habilitado mas ainda há alguém aguardando o prazo (ou já tentado) — não pode marcar a campanha como DONE ainda. */
async function hasPendingFollowUps(campaignId: string): Promise<boolean> {
  const count = await prisma.campaignRecipient.count({
    where: { campaignId, status: "SENT", repliedAt: null, followUpSentAt: null },
  });
  return count > 0;
}

function buildVariables(contact: Contact) {
  return { nome: contact.name, cargo: contact.jobTitle, empresa: contact.company, cidade: contact.city };
}

type SendKind = "initial" | "followUp";

async function sendToRecipient(
  organizationId: string,
  campaign: CampaignRow,
  recipient: { id: string; contact: Contact },
  kind: SendKind,
): Promise<"sent" | "failed" | "skipped"> {
  const phoneNormalized = normalizePhoneNumber(recipient.contact.whatsapp || recipient.contact.phone);
  if (!phoneNormalized) {
    if (kind === "initial") {
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "SKIPPED", error: "Contato sem WhatsApp/celular cadastrado" },
      });
    } else {
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { followUpSentAt: new Date(), followUpError: "Contato sem WhatsApp/celular cadastrado" },
      });
    }
    return "skipped";
  }

  try {
    const templates = (
      kind === "followUp" && campaign.followUpTemplates ? campaign.followUpTemplates : campaign.messageTemplates
    ) as unknown as WeightedScript[];
    const chosen = pickWeighted(templates);
    const steps = renderSteps(chosen.steps, buildVariables(recipient.contact), brazilGreeting());

    const thread = await getOrCreateThread({ organizationId, instanceId: campaign.instanceId, phoneNormalized });
    // Manda a sequência do script inteira numa tacada só, com o delay real
    // configurado entre as partes — é o que faz o script de várias mensagens
    // parecer alguém digitando em seguida, não disparos avulsos minutos
    // depois (o delay ENTRE destinatários continua sendo o do cron/shouldSendNow).
    // campaignId vai em toda mensagem enviada por aqui — é o que separa
    // prospecção fria de conversa manual/automação nos relatórios, sem
    // precisar adivinhar pelo conteúdo ou pelo horário.
    for (let i = 0; i < steps.length; i++) {
      await sendWhatsAppMessage({ organizationId, threadId: thread.id, text: steps[i].text, campaignId: campaign.id });
      if (i < steps.length - 1 && steps[i].delayAfterSec > 0) {
        await sleep(steps[i].delayAfterSec * 1000);
      }
    }

    if (kind === "initial") {
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "SENT", sentAt: new Date(), threadId: thread.id, scriptId: chosen.scriptId },
      });
    } else {
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { followUpSentAt: new Date(), followUpScriptId: chosen.scriptId },
      });
    }
    return "sent";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (kind === "initial") {
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "FAILED" as $Enums.CampaignRecipientStatus, error: message },
      });
      await pauseIfFailing(campaign.id);
    } else {
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { followUpSentAt: new Date(), followUpError: message },
      });
    }
    return "failed";
  }
}

export type SendNowResult =
  | { ok: true; outcome: "sent" | "failed" | "skipped"; kind: SendKind }
  | { ok: false; reason: "not-running" | "outside-schedule" | "daily-cap-reached" | "no-pending" };

/**
 * Ação manual do botão "Enviar agora" na página da campanha — pula só o
 * throttle de delay-desde-o-último-envio (shouldSendNow), que é o único
 * limite que o pedido do usuário mencionou explicitamente. Janela de
 * horário e teto diário continuam valendo, senão um clique fora do horário
 * configurado furaria a régua que o próprio usuário definiu pra campanha.
 */
export async function sendCampaignRecipientNow(organizationId: string, campaignId: string): Promise<SendNowResult> {
  return runWithTenant(organizationId, async () => {
    const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, organizationId } });
    if (!campaign || campaign.status !== "RUNNING") return { ok: false, reason: "not-running" };
    if (!isWithinSchedule(campaign)) return { ok: false, reason: "outside-schedule" };
    if (await dailyCapReached(campaign)) return { ok: false, reason: "daily-cap-reached" };

    const recipient = await prisma.campaignRecipient.findFirst({
      where: { campaignId: campaign.id, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: { contact: true },
    });
    if (recipient) {
      const outcome = await sendToRecipient(organizationId, campaign, recipient, "initial");
      return { ok: true, outcome, kind: "initial" };
    }

    if (campaign.followUpEnabled) {
      const followUpCandidate = await findFollowUpCandidate(campaign);
      if (followUpCandidate) {
        const outcome = await sendToRecipient(organizationId, campaign, followUpCandidate, "followUp");
        return { ok: true, outcome, kind: "followUp" };
      }
    }

    return { ok: false, reason: "no-pending" };
  });
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

        if (recipient) {
          const outcome = await sendToRecipient(org.id, campaign, recipient, "initial");
          if (outcome === "sent") sent += 1;
          if (outcome === "failed") failed += 1;
          continue;
        }

        // Sem mais destinatários pendentes — se o reenvio automático estiver
        // ligado, tenta achar alguém pronto pra ser reenviado antes de
        // considerar a campanha encerrada.
        if (campaign.followUpEnabled) {
          const followUpCandidate = await findFollowUpCandidate(campaign);
          if (followUpCandidate) {
            const outcome = await sendToRecipient(org.id, campaign, followUpCandidate, "followUp");
            if (outcome === "sent") sent += 1;
            if (outcome === "failed") failed += 1;
            continue;
          }
          if (await hasPendingFollowUps(campaign.id)) continue; // ainda dentro do prazo de espera
        }

        await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "DONE" } });
      }
    });
  }

  return { checked, sent, failed };
}
