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

// responsavel: fallback de {consultor} pra campanha MANUAL (ver buildVariables).
// instance.user: nome de quem enviou, quando o destinatário tem instanceId
// própria (campanha PIPELINE_BULK) — ver sendToRecipient.
const RECIPIENT_INCLUDE = {
  contact: { include: { responsavel: { select: { name: true } } } },
  instance: { select: { user: { select: { name: true } } } },
} as const;

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
    include: RECIPIENT_INCLUDE,
  });
}

/** Reenvio habilitado mas ainda há alguém aguardando o prazo (ou já tentado) — não pode marcar a campanha como DONE ainda. */
async function hasPendingFollowUps(campaignId: string): Promise<boolean> {
  const count = await prisma.campaignRecipient.count({
    where: { campaignId, status: "SENT", repliedAt: null, followUpSentAt: null },
  });
  return count > 0;
}

/**
 * consultorName vem de recipient.instanceId (campanhas PIPELINE_BULK — ver
 * sendToRecipient) quando setado; senão cai pro responsável cadastrado no
 * próprio Contact (campanhas MANUAL, o caso de sempre).
 */
function buildVariables(contact: Contact & { responsavel?: { name: string } | null }, consultorName?: string | null) {
  return {
    nome: contact.name,
    cargo: contact.jobTitle,
    empresa: contact.company,
    cidade: contact.city,
    consultor: consultorName ?? contact.responsavel?.name ?? null,
  };
}

type SendKind = "initial" | "followUp";

type RecipientRow = {
  id: string;
  contact: Contact & { responsavel?: { name: string } | null };
  instanceId: string | null;
  instance?: { user: { name: string } } | null;
};

async function sendToRecipient(
  organizationId: string,
  campaign: CampaignRow,
  recipient: RecipientRow,
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
    const consultorName = recipient.instanceId ? (recipient.instance?.user.name ?? null) : null;
    const steps = renderSteps(chosen.steps, buildVariables(recipient.contact, consultorName), brazilGreeting());

    // Campanha PIPELINE_BULK: cada destinatário pode ter sua própria
    // instância (o responsável do negócio que originou o envio) — ver
    // Campaign.source/CampaignRecipient.instanceId. Campanha MANUAL (o caso
    // de sempre): recipient.instanceId é sempre null, cai no fallback de
    // sempre, comportamento idêntico ao de antes desse campo existir.
    const thread = await getOrCreateThread({
      organizationId,
      instanceId: recipient.instanceId ?? campaign.instanceId,
      phoneNormalized,
    });

    // Manda só o 1º passo antes de marcar o destinatário como enviado — é o
    // único envio que decide sucesso/falha daqui. Isso importa porque os
    // passos seguintes têm delay REAL (sleep) entre eles, então o processo
    // pode ser encerrado por timeout de plataforma no meio da sequência; se
    // só marcássemos "enviado" depois do loop inteiro (como era antes), um
    // corte nesse meio-tempo deixava o destinatário como PENDING e o
    // próximo tick do cron reenviava a sequência INTEIRA do zero pro mesmo
    // lead — duplicando a 1ª mensagem, que já tinha sido entregue de verdade.
    await sendWhatsAppMessage({ organizationId, threadId: thread.id, text: steps[0].text, campaignId: campaign.id });

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

    // Passos restantes (se houver) são melhor-esforço: o destinatário já
    // está marcado como enviado, então uma falha aqui nunca deve reverter
    // esse status nem contar como falha do envio — só fica registrada no
    // log, sem acionar pauseIfFailing.
    for (let i = 0; i < steps.length - 1; i++) {
      try {
        if (steps[i].delayAfterSec > 0) await sleep(steps[i].delayAfterSec * 1000);
        await sendWhatsAppMessage({ organizationId, threadId: thread.id, text: steps[i + 1].text, campaignId: campaign.id });
      } catch (err) {
        console.error(
          `[campaigns] falha ao enviar passo ${i + 2}/${steps.length} do script pro destinatário ${recipient.id} (já marcado como enviado, 1º passo entregue)`,
          err,
        );
        break;
      }
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
      include: RECIPIENT_INCLUDE,
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
          include: RECIPIENT_INCLUDE,
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
