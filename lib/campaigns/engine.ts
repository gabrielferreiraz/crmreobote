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
import { warmupDailyCap } from "@/lib/whatsapp/warmup";
import { getSuppressionReason, suppressionMessage } from "@/lib/campaigns/engagement";
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
  source: $Enums.CampaignSource;
  instanceId: string;
  messageTemplates: unknown;
  followUpEnabled: boolean;
  followUpDelayHours: number;
  followUpTemplates: unknown;
  rmktWaves: unknown;
  noReplyDays: number | null;
  delayMinSec: number;
  delayMaxSec: number;
  dailyCap: number | null;
  allowedWeekdays: number[];
  windowStartHour: number;
  windowEndHour: number;
};

/** Uma onda de RMKT — dayOffset conta a partir do envio INICIAL, não da onda anterior (ver Campaign.rmktWaves). */
type RmktWave = { dayOffset: number; templates: WeightedScript[] };

function parseRmktWaves(raw: unknown): RmktWave[] {
  return Array.isArray(raw) ? (raw as RmktWave[]) : [];
}

function isWithinSchedule(campaign: CampaignRow): boolean {
  const now = new Date();
  if (!campaign.allowedWeekdays.includes(brazilWeekday(now))) return false;
  const hour = brazilHour(now);
  return hour >= campaign.windowStartHour && hour < campaign.windowEndHour;
}

/**
 * Teto efetivo é o MENOR entre o configurado na campanha e o permitido pelo
 * aquecimento do número (ver lib/whatsapp/warmup.ts) — mesmo uma campanha
 * configurada sem teto (dailyCap null) fica presa à rampa enquanto o número
 * ainda está esfriando os primeiros dias. Usa sempre o instanceId "principal"
 * da campanha (mesma simplificação que a contagem de SENT já fazia antes:
 * conta todo envio do dia, mesmo os que uma campanha PIPELINE_BULK despachou
 * por uma instância diferente por destinatário).
 */
async function dailyCapReached(campaign: CampaignRow): Promise<boolean> {
  const count = await prisma.campaignRecipient.count({
    where: { campaignId: campaign.id, status: "SENT", sentAt: { gte: brazilStartOfDay() } },
  });

  const instance = await prisma.whatsAppInstance.findUnique({
    where: { id: campaign.instanceId },
    select: { provider: true, firstConnectedAt: true },
  });
  const warmupCap = instance?.provider === "EVOLUTION" ? warmupDailyCap(instance.firstConnectedAt) : null;

  const caps = [campaign.dailyCap, warmupCap].filter((c): c is number => c != null);
  if (caps.length === 0) return false;
  return count >= Math.min(...caps);
}

/**
 * Amostra de uma distribuição gaussiana (Box-Muller) centrada no meio da
 * faixa, sempre recortada de volta pra dentro de [min, max] — um intervalo
 * uniforme entre mensagens é, ele mesmo, um padrão estatístico reconhecível
 * (muitos valores "no limite" mín/máx); gaussiana concentra a maioria dos
 * envios perto do meio da faixa, com caudas mais raras nos extremos, mais
 * parecido com o ritmo irregular de uma pessoa de verdade.
 */
function gaussianDelaySample(minSec: number, maxSec: number): number {
  if (maxSec <= minSec) return minSec;
  const mean = (minSec + maxSec) / 2;
  const stdDev = (maxSec - minSec) / 4; // ±2 desvios cobre a faixa inteira

  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);

  return Math.min(maxSec, Math.max(minSec, mean + z * stdDev));
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

  const threshold = gaussianDelaySample(campaign.delayMinSec, campaign.delayMaxSec);
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
 * Roda pra QUALQUER campanha com RMKT configurado (Campaign.rmktWaves +
 * noReplyDays, ver os dois pontos de chamada abaixo que gateiam por
 * `noReplyDays != null`) — acha o próximo destinatário com uma onda de RMKT
 * vencida (dayOffset contado a partir do envio INICIAL, `sentAt`) que ainda
 * não respondeu. Busca os candidatos elegíveis (nextWaveIndex ainda dentro
 * do array) e filtra em memória quem já venceu, porque o prazo de cada um
 * depende de EM QUE onda ele está — não dá pra expressar isso num único
 * `where` do Prisma.
 *
 * Não filtra mais por `dealId: null` — antes isso restringia RMKT só a
 * LEAD_CAPTURE (onde o negócio só existe se/quando o contato responder,
 * então "sem negócio" e "sem resposta" eram a mesma coisa). PIPELINE_BULK
 * (envio em massa pra quem JÁ tem negócio, ver
 * app/api/deals/bulk-send-message/route.ts) seta `dealId` desde a CRIAÇÃO
 * do destinatário — com o filtro antigo, esses destinatários nunca
 * entravam aqui, mesmo com onda configurada. `repliedAt: null` sozinho já
 * é suficiente nos dois casos (reply.ts sempre seta `repliedAt` antes de
 * qualquer lógica de negócio, então nunca fica um `dealId` setado com
 * `repliedAt` ainda null pra essa checagem se confundir). */
async function findNextWaveCandidate(
  campaign: CampaignRow,
): Promise<{ recipient: RecipientRow; wave: RmktWave; waveIndex: number } | null> {
  const waves = parseRmktWaves(campaign.rmktWaves);
  if (waves.length === 0) return null;

  const candidates = await prisma.campaignRecipient.findMany({
    where: {
      campaignId: campaign.id,
      status: "SENT",
      repliedAt: null,
      nextWaveIndex: { lt: waves.length },
    },
    orderBy: { sentAt: "asc" },
    include: RECIPIENT_INCLUDE,
  });

  const now = Date.now();
  for (const recipient of candidates) {
    const wave = waves[recipient.nextWaveIndex];
    if (!wave || !recipient.sentAt) continue;
    const dueAt = recipient.sentAt.getTime() + wave.dayOffset * 24 * 60 * 60 * 1000;
    if (now >= dueAt) return { recipient, wave, waveIndex: recipient.nextWaveIndex };
  }
  return null;
}

/** Quem passou de Campaign.noReplyDays sem responder vira FAILED ("Não
 * respondeu"), não importa se ainda tinha onda de RMKT programada — mesmo
 * motivo do comentário acima, vale pra qualquer origem de campanha com RMKT
 * configurado, não só LEAD_CAPTURE. */
async function findExpiredLeadCaptureRecipient(campaign: CampaignRow) {
  if (campaign.noReplyDays == null) return null;
  const cutoff = new Date(Date.now() - campaign.noReplyDays * 24 * 60 * 60 * 1000);
  return prisma.campaignRecipient.findFirst({
    where: { campaignId: campaign.id, status: "SENT", repliedAt: null, sentAt: { lte: cutoff } },
  });
}

/** Ainda há destinatário enviado sem resposta — a campanha não pode ser
 * marcada DONE enquanto existir algum (esperando onda ou prazo de
 * expiração). Mesmo motivo dos comentários acima. */
async function hasUnresolvedLeadCaptureRecipients(campaignId: string): Promise<boolean> {
  const count = await prisma.campaignRecipient.count({
    where: { campaignId, status: "SENT", repliedAt: null },
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

type SendKind = "initial" | "followUp" | "wave";

type RecipientRow = {
  id: string;
  contact: Contact & { responsavel?: { name: string } | null };
  instanceId: string | null;
  instance?: { user: { name: string } } | null;
  nextWaveIndex: number;
};

export type SendOutcome = "sent" | "failed" | "skipped" | "claimed-by-other";

/**
 * Reivindica o destinatário ATOMICAMENTE antes de qualquer outra coisa —
 * `updateMany` com a condição da corrida no próprio WHERE, não um
 * findFirst+update separados. Isso importa porque app/api/cron/campaigns
 * roda a cada 1-2min via cron-job.org (serviço externo, sem garantia
 * nenhuma de exclusão mútua entre execuções — se um tick demorar mais que o
 * intervalo, como facilmente acontece com um script de vários passos com
 * delay real entre eles, o próximo tick já começa por cima do anterior).
 * Sem essa reivindicação atômica, dois ticks concorrentes liam o mesmo
 * destinatário PENDING e mandavam a MESMA mensagem duas vezes pro mesmo lead
 * — exatamente o padrão "parece disparo automático" que o motor inteiro
 * existe pra evitar. Cada `kind` reivindica por um campo diferente porque
 * cada um usa um critério de "ainda não processado" diferente:
 * status=PENDING (inicial), followUpSentAt=null (reenvio), nextWaveIndex
 * exato (onda de RMKT). Devolve `false` quando outra execução venceu a
 * corrida — quem chama não deve tratar isso como erro, só não fazer nada
 * (o destinatário já está sendo cuidado agora por outro processo).
 */
async function claimRecipient(recipient: RecipientRow, kind: SendKind): Promise<boolean> {
  if (kind === "initial") {
    const claim = await prisma.campaignRecipient.updateMany({
      where: { id: recipient.id, status: "PENDING" },
      data: { status: "SENDING", sentAt: new Date() },
    });
    return claim.count === 1;
  }
  if (kind === "followUp") {
    const claim = await prisma.campaignRecipient.updateMany({
      where: { id: recipient.id, followUpSentAt: null },
      data: { followUpSentAt: new Date() },
    });
    return claim.count === 1;
  }
  const claim = await prisma.campaignRecipient.updateMany({
    where: { id: recipient.id, nextWaveIndex: recipient.nextWaveIndex },
    data: { nextWaveIndex: recipient.nextWaveIndex + 1 },
  });
  return claim.count === 1;
}

/** Preenche os detalhes finais (script sorteado ou erro) de uma tentativa não-inicial já reivindicada — não mexe mais em followUpSentAt/nextWaveIndex, isso já foi feito no claim. */
async function finalizeNonInitialAttempt(recipientId: string, data: { scriptId?: string; error?: string }) {
  await prisma.campaignRecipient.update({
    where: { id: recipientId },
    data: { followUpScriptId: data.scriptId, followUpError: data.error },
  });
}

async function sendToRecipient(
  organizationId: string,
  campaign: CampaignRow,
  recipient: RecipientRow,
  kind: SendKind,
  wave?: RmktWave,
): Promise<SendOutcome> {
  if (!(await claimRecipient(recipient, kind))) return "claimed-by-other";

  const phoneNormalized = normalizePhoneNumber(recipient.contact.whatsapp || recipient.contact.phone);
  if (!phoneNormalized) {
    const message = "Contato sem WhatsApp/celular cadastrado";
    if (kind === "initial") {
      await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "SKIPPED", error: message } });
    } else {
      await finalizeNonInitialAttempt(recipient.id, { error: message });
    }
    return "skipped";
  }

  // Opt-out ou "cold streak" (ver lib/campaigns/engagement.ts) — checado a
  // cada envio (não só na criação da lista) porque um contato pode virar
  // suprimido DEPOIS de já estar na lista de destinatários (respondeu opt-out
  // numa campanha anterior, por exemplo).
  const suppression = await getSuppressionReason(recipient.contact.id);
  if (suppression) {
    const message = suppressionMessage(suppression);
    if (kind === "initial") {
      await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "SKIPPED", error: message } });
    } else {
      await finalizeNonInitialAttempt(recipient.id, { error: message });
    }
    return "skipped";
  }

  try {
    const templates = (
      kind === "wave" && wave
        ? wave.templates
        : kind === "followUp" && campaign.followUpTemplates
          ? campaign.followUpTemplates
          : campaign.messageTemplates
    ) as unknown as WeightedScript[];
    const chosen = pickWeighted(templates);
    const consultorName = recipient.instanceId ? (recipient.instance?.user.name ?? null) : null;
    const steps = renderSteps(chosen.steps, buildVariables(recipient.contact, consultorName), brazilGreeting());

    // Campanha PIPELINE_BULK: cada destinatário pode ter sua própria
    // instância (o responsável do negócio que originou o envio) — ver
    // Campaign.source/CampaignRecipient.instanceId. Campanha MANUAL/
    // LEAD_CAPTURE (recipient.instanceId sempre null): cai no fallback de
    // sempre, um único WhatsApp pra campanha inteira.
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
    // corte nesse meio-tempo deixava o destinatário sem ter sido finalizado.
    // (Já foi reivindicado — status SENDING/followUpSentAt/nextWaveIndex já
    // avançados no claimRecipient acima — então mesmo essa queda nunca
    // reenvia em duplicidade; só fica preso em SENDING até
    // recoverStaleSendingRecipients resolver.)
    await sendWhatsAppMessage({
      organizationId,
      threadId: thread.id,
      text: steps[0].text,
      campaignId: campaign.id,
      simulateTypingFirst: true,
    });

    if (kind === "initial") {
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "SENT", threadId: thread.id, scriptId: chosen.scriptId },
      });
    } else {
      await finalizeNonInitialAttempt(recipient.id, { scriptId: chosen.scriptId });
    }

    // Passos restantes (se houver) são melhor-esforço: o destinatário já
    // está marcado como enviado, então uma falha aqui nunca deve reverter
    // esse status nem contar como falha do envio — só fica registrada no
    // log, sem acionar pauseIfFailing.
    for (let i = 0; i < steps.length - 1; i++) {
      try {
        if (steps[i].delayAfterSec > 0) await sleep(steps[i].delayAfterSec * 1000);
        await sendWhatsAppMessage({
          organizationId,
          threadId: thread.id,
          text: steps[i + 1].text,
          campaignId: campaign.id,
          simulateTypingFirst: true,
        });
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
      await finalizeNonInitialAttempt(recipient.id, { error: message });
    }
    return "failed";
  }
}

/**
 * Destinatário preso em SENDING além do razoável — o processo caiu (timeout
 * de plataforma, deploy no meio do envio) entre reivindicar o destinatário
 * (claimRecipient) e terminar de gravar o resultado. NUNCA solta de volta
 * pra PENDING: não há como saber se a mensagem já saiu de verdade antes da
 * queda, e arriscar isso duplicaria a mensagem pro lead — o mesmo problema
 * que a reivindicação atômica existe pra evitar. Marca como falha (visível
 * pra alguém conferir manualmente se precisa) em vez de tentar de novo sozinho.
 */
const STALE_SENDING_MS = 10 * 60 * 1000;

async function recoverStaleSendingRecipients(campaignId: string): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_SENDING_MS);
  await prisma.campaignRecipient.updateMany({
    where: { campaignId, status: "SENDING", sentAt: { lte: cutoff } },
    data: {
      status: "FAILED",
      error: "Envio interrompido antes de confirmar (processo encerrado no meio) — verifique manualmente se a mensagem chegou",
    },
  });
}

export type SendNowResult =
  | { ok: true; outcome: SendOutcome; kind: SendKind }
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

    // noReplyDays != null (não mais "source === LEAD_CAPTURE") — só é
    // preenchido quando a campanha de fato configurou RMKT, então já
    // funciona pra qualquer origem que venha a ter RMKT, PIPELINE_BULK
    // incluído (ver comentário em findNextWaveCandidate acima).
    if (campaign.noReplyDays != null) {
      const waveCandidate = await findNextWaveCandidate(campaign);
      if (waveCandidate) {
        const outcome = await sendToRecipient(organizationId, campaign, waveCandidate.recipient, "wave", waveCandidate.wave);
        return { ok: true, outcome, kind: "wave" };
      }
    }

    return { ok: false, reason: "no-pending" };
  });
}

export async function runCampaigns(): Promise<{ checked: number; sent: number; failed: number }> {
  // Organização não tem RLS — listar aqui é seguro; cada uma é processada
  // depois já com o tenant certo (mesmo padrão de runAutomations/health-check).
  const organizations = await prisma.organization.findMany({ select: { id: true } });

  let checked = 0;
  let sent = 0;
  let failed = 0;

  for (const org of organizations) {
    try {
      await runWithTenant(org.id, async () => {
        const campaigns = await prisma.campaign.findMany({ where: { status: "RUNNING" } });

        for (const campaign of campaigns) {
          checked += 1;
          // Isolado por campanha — uma campanha com dado inconsistente (ex.:
          // messageTemplates corrompido) ou um erro de rede persistente não
          // pode travar TODAS as campanhas seguintes desta organização (e,
          // sem o try/catch do org logo abaixo, de organizações seguintes
          // também) neste mesmo tick. Cron roda de novo em 1-2min de
          // qualquer forma — uma campanha perdida neste tick não é grave,
          // travar todas as outras seria.
          try {
            await recoverStaleSendingRecipients(campaign.id);
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

            // RMKT configurado (noReplyDays != null, não mais "source ===
            // LEAD_CAPTURE" — ver comentário em findNextWaveCandidate):
            // manda a próxima onda vencida, ou expira (FAILED "Não
            // respondeu") quem passou de noReplyDays — nessa ordem, então
            // uma onda que já venceu tem prioridade sobre a expiração de
            // OUTRO destinatário no mesmo tick (o expirado espera o próximo).
            if (campaign.noReplyDays != null) {
              const waveCandidate = await findNextWaveCandidate(campaign);
              if (waveCandidate) {
                const outcome = await sendToRecipient(org.id, campaign, waveCandidate.recipient, "wave", waveCandidate.wave);
                if (outcome === "sent") sent += 1;
                if (outcome === "failed") failed += 1;
                continue;
              }

              const expired = await findExpiredLeadCaptureRecipient(campaign);
              if (expired) {
                await prisma.campaignRecipient.update({
                  where: { id: expired.id },
                  data: { status: "FAILED", error: "Não respondeu" },
                });
                continue;
              }

              if (await hasUnresolvedLeadCaptureRecipients(campaign.id)) continue; // ainda esperando onda/prazo
            }

            await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "DONE" } });
          } catch (err) {
            console.error(`[campaigns] falha ao processar campanha ${campaign.id} (organização ${org.id}) — outras campanhas seguem normalmente`, err);
          }
        }
      });
    } catch (err) {
      console.error(`[campaigns] falha ao processar organização ${org.id} — outras organizações seguem normalmente`, err);
    }
  }

  return { checked, sent, failed };
}
