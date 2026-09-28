/**
 * Fila de disparo de uma campanha — leitura (a lista paginada com o horário
 * previsto de cada um e "quem sai na próxima hora") e as duas escritas que a
 * tela oferece: reordenar uma janela (arrastar) e mover um contato pro topo/
 * fim. Ver lib/campaigns/queue-order.ts (a ordenação única usada pelo motor) e
 * lib/campaigns/queue-estimate.ts (de onde vêm os horários).
 *
 * As funções de LEITURA rodam dentro de runWithTenant (usam `prisma`); as de
 * ESCRITA abrem a própria transação (prismaRaw + setTenantOnTx), porque
 * precisam de atomicidade real entre vários passos. Nenhuma checa QUEM pode
 * mexer — isso é da rota (escopo de gerência da campanha, ver
 * app/api/campaigns/[id]/queue/route.ts).
 */
import { prisma, prismaRaw } from "@/lib/prisma";
import { setTenantOnTx } from "@/lib/tenant-context";
import type { $Enums, Prisma } from "@/app/generated/prisma/client";
import { brazilHour, brazilStartOfDay, brazilWeekday } from "@/lib/timezone";
import { normalizePhoneNumber } from "@/lib/phone-normalize";
import { warmupDailyCap } from "@/lib/whatsapp/warmup";
import { parsePauseReason } from "@/lib/campaigns/pause-reasons";
import { CAMPAIGN_QUEUE_ORDER_BY, reassignWindowPositions, type PositionedId } from "@/lib/campaigns/queue-order";
import {
  countWithinNextHour,
  estimateQueueSlots,
  expectedScriptProcessingSec,
  resolvePace,
  type QueuePace,
} from "@/lib/campaigns/queue-estimate";

/** Onde a campanha está agora — decide a frase de status no topo da fila. */
export type QueueState =
  | "sending" // dentro da janela, mandando no ritmo
  | "outside-window" // RUNNING, mas fora de dia/horário permitido — retoma na próxima janela
  | "cap-reached" // RUNNING, mas o teto diário já foi batido hoje
  | "paused"
  | "paused-auto" // pausada pelo próprio motor (WhatsApp caiu, número instável, falhas seguidas) — ver Campaign.pausedReason
  | "not-started" // rascunho
  | "done" // encerrada — a fila não anda mais
  | "no-schedule"; // sem dia permitido / janela inválida: nada é enviado

export type QueueItemView = {
  id: string;
  /** Posição na fila inteira (1 = próximo a sair), não na página. */
  rank: number;
  contactName: string;
  contactPhone: string | null;
  contactJobTitle: string | null;
  /** Horário previsto (ISO). null = a campanha não tem como enviar (ver QueueState "no-schedule"). */
  estimatedAt: string | null;
};

export type CampaignQueueView = {
  campaignId: string;
  status: $Enums.CampaignStatus;
  state: QueueState;
  /** Quantos pendentes existem na fila inteira. */
  total: number;
  offset: number;
  items: QueueItemView[];
  pace: QueuePace;
  /** Teto de envios por dia que vale hoje (menor entre o da campanha e o de aquecimento); null = sem teto. */
  dailyLimit: number | null;
  sentToday: number;
  nextHour: {
    /** Fim da janela de uma hora (ISO). */
    untilAt: string;
    /** Quantos devem sair até `untilAt` (a lista abaixo é limitada, esta contagem não). */
    count: number;
    items: { id: string; contactName: string; estimatedAt: string }[];
  };
  serverNow: string;
};

/** Campanha encerrada (DONE) não tem mais fila pra reordenar — só estes status aceitam edição (rota + tela usam a mesma lista). */
export const QUEUE_EDITABLE_STATUSES: readonly $Enums.CampaignStatus[] = ["DRAFT", "RUNNING", "PAUSED"];

const RECENT_SENDS_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const RECENT_SENDS_LIMIT = 60;
const NEXT_HOUR_LIST_LIMIT = 40;
const SEARCH_LIMIT = 20;
/** Linhas por página da fila — a tela carrega até 500 (arrastar mais que isso não é usável; o resto se acha pela busca). */
const MAX_PAGE_SIZE = 500;
/** Trava de segurança das estimativas: uma fila de 25 mil pendentes não precisa de 25 mil horários pra mostrar 100 linhas. */
const MAX_SLOTS = 3000;

type CampaignForQueue = {
  id: string;
  status: $Enums.CampaignStatus;
  pausedReason: string | null;
  delayMinSec: number;
  delayMaxSec: number;
  dailyCap: number | null;
  allowedWeekdays: number[];
  windowStartHour: number;
  windowEndHour: number;
  messageTemplates: unknown;
  instance: { provider: $Enums.WhatsAppProvider; firstConnectedAt: Date | null };
};

async function loadCampaignForQueue(organizationId: string, campaignId: string): Promise<CampaignForQueue | null> {
  return prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
    select: {
      id: true,
      status: true,
      pausedReason: true,
      delayMinSec: true,
      delayMaxSec: true,
      dailyCap: true,
      allowedWeekdays: true,
      windowStartHour: true,
      windowEndHour: true,
      messageTemplates: true,
      instance: { select: { provider: true, firstConnectedAt: true } },
    },
  });
}

/** Tudo que o horário previsto depende, medido AGORA no banco. */
async function loadPacing(campaign: CampaignForQueue, now: Date) {
  const [sentToday, lastSent, lastFollowUp, recent] = await Promise.all([
    prisma.campaignRecipient.count({
      where: { campaignId: campaign.id, status: "SENT", sentAt: { gte: brazilStartOfDay(now) } },
    }),
    prisma.campaignRecipient.aggregate({ where: { campaignId: campaign.id, status: "SENT" }, _max: { sentAt: true } }),
    prisma.campaignRecipient.aggregate({ where: { campaignId: campaign.id, followUpSentAt: { not: null } }, _max: { followUpSentAt: true } }),
    prisma.campaignRecipient.findMany({
      where: { campaignId: campaign.id, status: "SENT", sentAt: { gte: new Date(now.getTime() - RECENT_SENDS_WINDOW_MS) } },
      orderBy: { sentAt: "desc" },
      take: RECENT_SENDS_LIMIT,
      select: { sentAt: true },
    }),
  ]);

  // O motor conta o delay a partir do ÚLTIMO evento de envio, inicial ou reenvio (ver shouldSendNow).
  const candidates = [lastSent._max.sentAt, lastFollowUp._max.followUpSentAt].filter((d): d is Date => !!d);
  const lastEventAt = candidates.length ? new Date(Math.max(...candidates.map((d) => d.getTime()))) : null;

  // Mesmo teto do motor (dailyCapReached): o menor entre o da campanha e o de aquecimento do número.
  const warmupCap = campaign.instance.provider === "EVOLUTION" ? warmupDailyCap(campaign.instance.firstConnectedAt) : null;
  const caps = [campaign.dailyCap, warmupCap].filter((c): c is number => c !== null);
  const dailyLimit = caps.length ? Math.min(...caps) : null;

  const pace = resolvePace({
    minSec: campaign.delayMinSec,
    maxSec: campaign.delayMaxSec,
    processingSec: expectedScriptProcessingSec(campaign.messageTemplates),
    recentSentAtDesc: recent.map((r) => r.sentAt).filter((d): d is Date => !!d),
  });

  return { sentToday, lastEventAt, dailyLimit, pace };
}

function resolveState(campaign: CampaignForQueue, now: Date, sentToday: number, dailyLimit: number | null): QueueState {
  if (campaign.status === "DRAFT") return "not-started";
  if (campaign.status === "DONE") return "done";
  if (campaign.status !== "RUNNING") return parsePauseReason(campaign.pausedReason) ? "paused-auto" : "paused";
  if (campaign.allowedWeekdays.length === 0 || campaign.windowEndHour <= campaign.windowStartHour) return "no-schedule";
  const inWindow =
    campaign.allowedWeekdays.includes(brazilWeekday(now)) &&
    brazilHour(now) >= campaign.windowStartHour &&
    brazilHour(now) < campaign.windowEndHour;
  if (!inWindow) return "outside-window";
  if (dailyLimit !== null && sentToday >= dailyLimit) return "cap-reached";
  return "sending";
}

const contactSelect = { select: { name: true, whatsapp: true, phone: true, jobTitle: true } } as const;

async function queueRankOf(input: {
  campaignId: string;
  id: string;
  queuePosition: number | null;
  createdAt: Date;
}): Promise<number> {
  const { campaignId, id, queuePosition, createdAt } = input;
  const before = await prisma.campaignRecipient.count({
    where: {
      campaignId,
      status: "PENDING",
      OR:
        queuePosition === null
          ? [
              { queuePosition: { not: null } },
              { queuePosition: null, createdAt: { lt: createdAt } },
              { queuePosition: null, createdAt, id: { lt: id } },
            ]
          : [
              { queuePosition: { lt: queuePosition } },
              { queuePosition, createdAt: { lt: createdAt } },
              { queuePosition, createdAt, id: { lt: id } },
            ],
    },
  });
  return before + 1;
}

/**
 * A fila numa página (`offset`/`limit`) com o horário previsto de cada um e o
 * resumo da próxima hora. null = campanha não existe nesta organização.
 */
export async function getCampaignQueue(
  organizationId: string,
  campaignId: string,
  opts: { offset?: number; limit?: number } = {},
): Promise<CampaignQueueView | null> {
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(opts.limit ?? 100)));

  const campaign = await loadCampaignForQueue(organizationId, campaignId);
  if (!campaign) return null;

  const now = new Date();
  const [total, pacing] = await Promise.all([
    prisma.campaignRecipient.count({ where: { campaignId, status: "PENDING" } }),
    loadPacing(campaign, now),
  ]);

  const rows = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: "PENDING" },
    orderBy: CAMPAIGN_QUEUE_ORDER_BY,
    skip: offset,
    take: limit,
    select: { id: true, queuePosition: true, createdAt: true, contact: contactSelect },
  });

  // A i-ésima posição da fila SEMPRE recebe o i-ésimo horário (ver estimateQueueSlots) — pra ter o
  // horário de quem está na página é preciso gerar do começo da fila até o fim dela; e a CONTAGEM da
  // próxima hora pode precisar de mais posições que a página tem (campanha rápida: centenas por hora).
  const inNextHourGuess = Math.ceil(3600 / pacing.pace.intervalSec) + 2;
  const wanted = Math.min(total, MAX_SLOTS, Math.max(offset + rows.length, inNextHourGuess));
  const slots = estimateQueueSlots({
    now,
    count: wanted,
    intervalSec: pacing.pace.intervalSec,
    lastEventAt: pacing.lastEventAt,
    schedule: campaign,
    dailyLimit: pacing.dailyLimit,
    sentToday: pacing.sentToday,
  });

  const items: QueueItemView[] = rows.map((r, i) => ({
    id: r.id,
    rank: offset + i + 1,
    contactName: r.contact.name,
    contactPhone: r.contact.whatsapp || r.contact.phone,
    contactJobTitle: r.contact.jobTitle,
    estimatedAt: slots[offset + i]?.toISOString() ?? null,
  }));

  // Próxima hora: quantos, e os primeiros nomes.
  const nextHourCount = countWithinNextHour(slots, now);
  const nextHourWanted = Math.min(nextHourCount, NEXT_HOUR_LIST_LIMIT);
  let nextHourNames: { id: string; contactName: string }[];
  if (offset === 0 && nextHourWanted <= rows.length) {
    nextHourNames = rows.slice(0, nextHourWanted).map((r) => ({ id: r.id, contactName: r.contact.name }));
  } else if (nextHourWanted > 0) {
    const top = await prisma.campaignRecipient.findMany({
      where: { campaignId, status: "PENDING" },
      orderBy: CAMPAIGN_QUEUE_ORDER_BY,
      take: nextHourWanted,
      select: { id: true, contact: { select: { name: true } } },
    });
    nextHourNames = top.map((r) => ({ id: r.id, contactName: r.contact.name }));
  } else {
    nextHourNames = [];
  }

  return {
    campaignId,
    status: campaign.status,
    state: resolveState(campaign, now, pacing.sentToday, pacing.dailyLimit),
    total,
    offset,
    items,
    pace: pacing.pace,
    dailyLimit: pacing.dailyLimit,
    sentToday: pacing.sentToday,
    nextHour: {
      untilAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      count: nextHourCount,
      items: nextHourNames.map((n, i) => ({ ...n, estimatedAt: slots[i].toISOString() })),
    },
    serverNow: now.toISOString(),
  };
}

/**
 * Acha contatos na fila por nome ou telefone — pra "puxar" alguém que está lá
 * no fundo de uma fila de milhares (a tela só carrega as primeiras posições).
 * Devolve até SEARCH_LIMIT resultados com a posição REAL na fila e o horário previsto.
 */
export async function searchCampaignQueue(organizationId: string, campaignId: string, query: string): Promise<QueueItemView[] | null> {
  const term = query.trim();
  if (term.length < 2) return [];

  const campaign = await loadCampaignForQueue(organizationId, campaignId);
  if (!campaign) return null;

  const digits = normalizePhoneNumber(term);
  const phoneFilters: Prisma.ContactWhereInput[] =
    digits && digits.length >= 4 ? [{ whatsappNormalized: { contains: digits } }, { phoneNormalized: { contains: digits } }] : [];

  const matches = await prisma.campaignRecipient.findMany({
    where: {
      campaignId,
      status: "PENDING",
      contact: { OR: [{ name: { contains: term, mode: "insensitive" } }, ...phoneFilters] },
    },
    take: SEARCH_LIMIT,
    select: { id: true, queuePosition: true, createdAt: true, contact: contactSelect },
  });
  if (matches.length === 0) return [];

  // Posição real de cada um: índice na fila inteira (só os ids — barato mesmo com dezenas de milhares).
  const ranks = await Promise.all(
    matches.map(async (m) => [m.id, await queueRankOf({ campaignId, id: m.id, queuePosition: m.queuePosition, createdAt: m.createdAt })] as const),
  );
  const rankById = new Map(ranks);

  const now = new Date();
  const pacing = await loadPacing(campaign, now);
  const deepest = Math.max(...matches.map((m) => rankById.get(m.id) ?? 0));
  const slots = estimateQueueSlots({
    now,
    count: Math.min(deepest, 30_000),
    intervalSec: pacing.pace.intervalSec,
    lastEventAt: pacing.lastEventAt,
    schedule: campaign,
    dailyLimit: pacing.dailyLimit,
    sentToday: pacing.sentToday,
  });

  return matches
    .map((m) => {
      const rank = rankById.get(m.id) ?? 0;
      return {
        id: m.id,
        rank,
        contactName: m.contact.name,
        contactPhone: m.contact.whatsapp || m.contact.phone,
        contactJobTitle: m.contact.jobTitle,
        estimatedAt: slots[rank - 1]?.toISOString() ?? null,
      };
    })
    .filter((m) => m.rank > 0)
    .sort((a, b) => a.rank - b.rank);
}

// ─── escritas ─────────────────────────────────────────────────────────

const WRITE_TX_OPTIONS = { timeout: 60_000, maxWait: 10_000 } as const;

/** Duas pessoas editando a mesma fila ao mesmo tempo esperam uma pela outra em vez de se atropelar. */
async function lockCampaignQueue(tx: Prisma.TransactionClient, campaignId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${campaignId}, 20260926))`;
}

/**
 * Grava posições em lote — UMA instrução por até 5.000 linhas, e só em quem
 * AINDA está pendente (se o cron reivindicou alguém no meio do caminho, essa
 * linha simplesmente não muda).
 */
async function writePositions(tx: Prisma.TransactionClient, campaignId: string, rows: PositionedId[]) {
  for (let i = 0; i < rows.length; i += 5000) {
    const chunk = rows.slice(i, i + 5000);
    await tx.$executeRaw`
      UPDATE "CampaignRecipient" AS r
      SET "queuePosition" = v.pos
      FROM unnest(${chunk.map((c) => c.id)}::text[], ${chunk.map((c) => c.position)}::int[]) AS v(id, pos)
      WHERE r.id = v.id AND r."campaignId" = ${campaignId} AND r.status = 'PENDING'`;
  }
}

/**
 * Enquanto alguém da fila não tem posição (campanha nunca reordenada), dá uma
 * posição 1..N a TODOS os pendentes na ordem em que o motor já os mandava —
 * sem mudar a ordem de ninguém. Só depois disso as operações abaixo podem
 * trocar posições entre si com segurança. Só roda na 1ª edição da fila.
 */
async function materializeQueue(tx: Prisma.TransactionClient, campaignId: string) {
  const withoutPosition = await tx.campaignRecipient.count({ where: { campaignId, status: "PENDING", queuePosition: null } });
  if (withoutPosition === 0) return;
  const ordered = await tx.campaignRecipient.findMany({
    where: { campaignId, status: "PENDING" },
    orderBy: CAMPAIGN_QUEUE_ORDER_BY,
    select: { id: true },
  });
  await writePositions(tx, campaignId, ordered.map((r, i) => ({ id: r.id, position: i + 1 })));
}

/**
 * Aplica a ordem pedida à JANELA de ids (ver reassignWindowPositions): quem
 * está fora dela não muda de lugar. Ids que já saíram da fila nesse meio-tempo
 * são ignorados — a fila anda sozinha enquanto a pessoa arrasta.
 */
export async function reorderCampaignQueue(
  organizationId: string,
  campaignId: string,
  orderedIds: string[],
): Promise<{ changed: number; ignored: number }> {
  return prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    await lockCampaignQueue(tx, campaignId);
    await materializeQueue(tx, campaignId);

    const found = await tx.campaignRecipient.findMany({
      where: { campaignId, status: "PENDING", id: { in: orderedIds } },
      select: { id: true, queuePosition: true },
    });
    const { updates, ignored } = reassignWindowPositions(
      found.map((f) => ({ id: f.id, position: f.queuePosition ?? 0 })),
      orderedIds,
    );
    if (updates.length > 0) await writePositions(tx, campaignId, updates);
    return { changed: updates.length, ignored: ignored.length };
  }, WRITE_TX_OPTIONS);
}

/**
 * Manda UM contato pro início ou pro fim da fila inteira, sem renumerar
 * ninguém: topo = uma posição abaixo da menor que existe, fim = uma acima da
 * maior. Vale também pra quem está lá no fundo de uma fila enorme.
 */
export async function moveCampaignQueueItem(
  organizationId: string,
  campaignId: string,
  recipientId: string,
  to: "top" | "bottom",
): Promise<{ moved: boolean; reason?: "not-pending" | "already-there" }> {
  return prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    await lockCampaignQueue(tx, campaignId);
    await materializeQueue(tx, campaignId);

    const target = await tx.campaignRecipient.findFirst({
      where: { id: recipientId, campaignId, status: "PENDING" },
      select: { queuePosition: true },
    });
    if (!target || target.queuePosition === null) return { moved: false, reason: "not-pending" as const };

    const bounds = await tx.campaignRecipient.aggregate({
      where: { campaignId, status: "PENDING" },
      _min: { queuePosition: true },
      _max: { queuePosition: true },
    });
    const min = bounds._min.queuePosition ?? target.queuePosition;
    const max = bounds._max.queuePosition ?? target.queuePosition;

    if ((to === "top" && target.queuePosition === min) || (to === "bottom" && target.queuePosition === max)) {
      // Já é o primeiro/último — mas só se ninguém mais divide essa mesma posição.
      const sharing = await tx.campaignRecipient.count({ where: { campaignId, status: "PENDING", queuePosition: target.queuePosition } });
      if (sharing === 1) return { moved: false, reason: "already-there" as const };
    }

    const position = to === "top" ? min - 1 : max + 1;
    const { count } = await tx.campaignRecipient.updateMany({
      where: { id: recipientId, campaignId, status: "PENDING" },
      data: { queuePosition: position },
    });
    return count === 1 ? { moved: true } : { moved: false, reason: "not-pending" as const };
  }, WRITE_TX_OPTIONS);
}
