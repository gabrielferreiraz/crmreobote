import { prisma } from "@/lib/prisma";
import type { $Enums } from "@/app/generated/prisma/client";
import { parseAudienceFilter, describeAudienceFilter, type AudienceFilter } from "@/lib/campaigns/audience";
import { brazilDateKey } from "@/lib/timezone";
import { estimateCampaignCompletion, nextAllowedSendWindow, type CompletionEstimate } from "@/lib/campaigns/estimate";

export type CampaignSummary = {
  id: string;
  name: string;
  status: $Enums.CampaignStatus;
  audienceFilter: AudienceFilter;
  audienceLabel: string;
  instanceName: string;
  createdByName: string;
  delayMinSec: number;
  delayMaxSec: number;
  dailyCap: number | null;
  allowedWeekdays: number[];
  windowStartHour: number;
  windowEndHour: number;
  followUpEnabled: boolean;
  followUpDelayHours: number;
  createdAt: Date;
  counts: { pending: number; sent: number; failed: number; skipped: number; replied: number };
};

/** Reaproveitado pela página (SSR) e por GET /api/campaigns, pra não duplicar o merge de contagens. */
export async function listCampaigns(organizationId: string): Promise<CampaignSummary[]> {
  const campaigns = await prisma.campaign.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    include: {
      instance: { include: { user: { select: { name: true } } } },
      createdBy: { select: { name: true } },
    },
  });

  const statusCounts = await prisma.campaignRecipient.groupBy({
    by: ["campaignId", "status"],
    where: { campaign: { organizationId } },
    _count: true,
  });
  const repliedRows = await prisma.campaignRecipient.findMany({
    where: { campaign: { organizationId }, repliedAt: { not: null } },
    select: { campaignId: true },
  });

  const countsByCampaign = new Map<string, CampaignSummary["counts"]>();
  for (const row of statusCounts) {
    const entry = countsByCampaign.get(row.campaignId) ?? { pending: 0, sent: 0, failed: 0, skipped: 0, replied: 0 };
    if (row.status === "PENDING") entry.pending += row._count;
    if (row.status === "SENT") entry.sent += row._count;
    if (row.status === "FAILED") entry.failed += row._count;
    if (row.status === "SKIPPED") entry.skipped += row._count;
    countsByCampaign.set(row.campaignId, entry);
  }
  for (const row of repliedRows) {
    const entry = countsByCampaign.get(row.campaignId) ?? { pending: 0, sent: 0, failed: 0, skipped: 0, replied: 0 };
    entry.replied += 1;
    countsByCampaign.set(row.campaignId, entry);
  }

  return campaigns.map((c) => {
    const audienceFilter = parseAudienceFilter(c.audienceFilter);
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      audienceFilter,
      audienceLabel: describeAudienceFilter(audienceFilter),
      instanceName: c.instance.user.name,
      createdByName: c.createdBy.name,
      delayMinSec: c.delayMinSec,
      delayMaxSec: c.delayMaxSec,
      dailyCap: c.dailyCap,
      allowedWeekdays: c.allowedWeekdays,
      windowStartHour: c.windowStartHour,
      windowEndHour: c.windowEndHour,
      followUpEnabled: c.followUpEnabled,
      followUpDelayHours: c.followUpDelayHours,
      createdAt: c.createdAt,
      counts: countsByCampaign.get(c.id) ?? { pending: 0, sent: 0, failed: 0, skipped: 0, replied: 0 },
    };
  });
}

export type CampaignRecipientRow = {
  id: string;
  contactName: string;
  contactPhone: string | null;
  contactJobTitle: string | null;
  status: $Enums.CampaignRecipientStatus;
  sentAt: Date | null;
  repliedAt: Date | null;
  followUpSentAt: Date | null;
  /**
   * Previsão de quando o reenvio automático deve sair pra ESTE destinatário
   * — sentAt + followUpDelayHours, só quando ele de fato está na fila (ver
   * findFollowUpCandidate em lib/campaigns/engine.ts: SENT, nunca respondeu,
   * reenvio ainda não tentado). null quando já foi reenviado (ver
   * followUpSentAt), já respondeu, ou a campanha não tem reenvio ligado —
   * nesses casos não há "próximo reenvio" nenhum pra prever. Mesma ideia de
   * "estimativa, não garantia" que nextSendEstimateAt já é lá embaixo: o
   * motor real ainda respeita janela de horário/dias e teto diário.
   */
  nextFollowUpAt: Date | null;
  scriptName: string | null;
  followUpScriptName: string | null;
  error: string | null;
};

/** Um ponto do gráfico do painel de métricas — um dia (calendário de Brasília), quantos envios e quantas respostas. */
export type CampaignDailyMetric = { date: string; sent: number; replied: number };

export type CampaignDetail = CampaignSummary & {
  recipients: CampaignRecipientRow[];
  dailyMetrics: CampaignDailyMetric[];
  completionEstimate: CompletionEstimate;
  /**
   * Estimativa de quando o próximo envio deve acontecer — último envio (ou
   * reenvio) + o delay médio configurado. É só uma expectativa: o motor real
   * (lib/campaigns/engine.ts's shouldSendNow) sorteia um novo limiar dentro
   * da faixa min/max a cada checagem do cron, então o disparo de verdade pode
   * acontecer um pouco antes ou depois deste instante. null quando não há
   * envio em andamento pra estimar (campanha não RUNNING, ou sem pendentes).
   */
  nextSendEstimateAt: Date | null;
  /**
   * Quantos destinatários já foram enviados, não responderam, e ainda vão
   * receber o reenvio automático (ver nextFollowUpAt em
   * CampaignRecipientRow) — pedido explícito: "não mostra quando vai
   * começar a fase de follow-up". 0 quando followUpEnabled é falso, ou
   * quando todo mundo já respondeu/já foi reenviado.
   */
  pendingFollowUpCount: number;
  /** O mais próximo entre todos os nextFollowUpAt de pendingFollowUpCount — null quando esse contador é 0. */
  nextFollowUpEstimateAt: Date | null;
};

/** Usado pela tela de destinatários — uma linha por contato, com status individual, mais a série diária pro painel de métricas. */
export async function getCampaignDetail(
  organizationId: string,
  campaignId: string,
): Promise<CampaignDetail | null> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
    include: {
      instance: { include: { user: { select: { name: true } } } },
      createdBy: { select: { name: true } },
      recipients: {
        orderBy: { createdAt: "asc" },
        include: { contact: { select: { name: true, whatsapp: true, phone: true, jobTitle: true } } },
      },
    },
  });
  if (!campaign) return null;

  const scriptIds = Array.from(
    new Set(campaign.recipients.flatMap((r) => [r.scriptId, r.followUpScriptId]).filter((id): id is string => !!id)),
  );
  const scripts = scriptIds.length
    ? await prisma.messageScript.findMany({ where: { id: { in: scriptIds } }, select: { id: true, name: true } })
    : [];
  const scriptNameById = new Map(scripts.map((s) => [s.id, s.name]));

  const counts = { pending: 0, sent: 0, failed: 0, skipped: 0, replied: 0 };
  let lastAt: Date | null = null;
  const metricsByDay = new Map<string, CampaignDailyMetric>();
  const bump = (date: Date, field: "sent" | "replied") => {
    const key = brazilDateKey(date);
    const entry = metricsByDay.get(key) ?? { date: key, sent: 0, replied: 0 };
    entry[field] += 1;
    metricsByDay.set(key, entry);
  };

  // Previsão de reenvio por destinatário — mesmo critério exato de
  // findFollowUpCandidate em lib/campaigns/engine.ts (SENT, nunca
  // respondeu, reenvio ainda não tentado), calculado uma vez aqui e
  // reaproveitado tanto no total agregado (pendingFollowUpCount/
  // nextFollowUpEstimateAt) quanto por linha (recipients.map lá embaixo).
  const nextFollowUpAtByRecipient = new Map<string, Date>();
  let pendingFollowUpCount = 0;
  let nextFollowUpEstimateAt: Date | null = null;

  for (const r of campaign.recipients) {
    if (r.status === "PENDING") counts.pending += 1;
    if (r.status === "SENT") counts.sent += 1;
    if (r.status === "FAILED") counts.failed += 1;
    if (r.status === "SKIPPED") counts.skipped += 1;
    if (r.repliedAt) counts.replied += 1;
    if (r.sentAt) bump(r.sentAt, "sent");
    if (r.repliedAt) bump(r.repliedAt, "replied");
    // Mesmo "último evento" que shouldSendNow usa em engine.ts — precisa do
    // maior timestamp entre envio inicial e reenvio, não só um dos dois.
    if (r.sentAt && (!lastAt || r.sentAt > lastAt)) lastAt = r.sentAt;
    if (r.followUpSentAt && (!lastAt || r.followUpSentAt > lastAt)) lastAt = r.followUpSentAt;

    if (campaign.followUpEnabled && r.status === "SENT" && !r.repliedAt && !r.followUpSentAt && r.sentAt) {
      const at = new Date(r.sentAt.getTime() + campaign.followUpDelayHours * 60 * 60 * 1000);
      nextFollowUpAtByRecipient.set(r.id, at);
      pendingFollowUpCount += 1;
      if (!nextFollowUpEstimateAt || at < nextFollowUpEstimateAt) nextFollowUpEstimateAt = at;
    }
  }

  const audienceFilter = parseAudienceFilter(campaign.audienceFilter);
  const completionEstimate = estimateCampaignCompletion(
    {
      delayMinSec: campaign.delayMinSec,
      delayMaxSec: campaign.delayMaxSec,
      dailyCap: campaign.dailyCap,
      allowedWeekdays: campaign.allowedWeekdays,
      windowStartHour: campaign.windowStartHour,
      windowEndHour: campaign.windowEndHour,
    },
    counts.pending,
  );

  // Sem nenhum envio ainda (lastAt null), o motor manda no próximo tick sem
  // exigir delay nenhum (ver shouldSendNow em lib/campaigns/engine.ts) — só
  // soma o delay médio quando já existe um envio anterior pra contar a partir dele.
  // Sempre empurrado pra dentro da janela de horário/dias permitida — sem
  // isso, uma campanha fora do horário (ex.: depois das 18h) mostrava "a
  // qualquer momento" mesmo não podendo mandar nada até o próximo dia útil.
  const nextSendEstimateAt =
    campaign.status === "RUNNING" && counts.pending > 0
      ? nextAllowedSendWindow(
          campaign,
          lastAt ? new Date(lastAt.getTime() + completionEstimate.avgDelaySec * 1000) : new Date(),
        )
      : null;

  // Mesmo empurrão pra dentro da janela permitida que nextSendEstimateAt já
  // leva acima — reenvio passa pelo mesmo shouldSendNow/janela de horário
  // do envio inicial (ver lib/campaigns/engine.ts), então um prazo que caiu
  // de madrugada só sai de verdade na próxima janela permitida.
  const nextFollowUpEstimateAtInWindow =
    campaign.status === "RUNNING" && nextFollowUpEstimateAt ? nextAllowedSendWindow(campaign, nextFollowUpEstimateAt) : nextFollowUpEstimateAt;

  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    audienceFilter,
    audienceLabel: describeAudienceFilter(audienceFilter),
    instanceName: campaign.instance.user.name,
    createdByName: campaign.createdBy.name,
    delayMinSec: campaign.delayMinSec,
    delayMaxSec: campaign.delayMaxSec,
    dailyCap: campaign.dailyCap,
    allowedWeekdays: campaign.allowedWeekdays,
    windowStartHour: campaign.windowStartHour,
    windowEndHour: campaign.windowEndHour,
    followUpEnabled: campaign.followUpEnabled,
    followUpDelayHours: campaign.followUpDelayHours,
    createdAt: campaign.createdAt,
    counts,
    recipients: campaign.recipients.map((r) => ({
      id: r.id,
      contactName: r.contact.name,
      contactPhone: r.contact.whatsapp || r.contact.phone,
      contactJobTitle: r.contact.jobTitle,
      status: r.status,
      sentAt: r.sentAt,
      repliedAt: r.repliedAt,
      followUpSentAt: r.followUpSentAt,
      nextFollowUpAt: nextFollowUpAtByRecipient.get(r.id) ?? null,
      scriptName: r.scriptId ? (scriptNameById.get(r.scriptId) ?? "Script removido") : null,
      followUpScriptName: r.followUpScriptId ? (scriptNameById.get(r.followUpScriptId) ?? "Script removido") : null,
      error: r.error ?? r.followUpError,
    })),
    dailyMetrics: Array.from(metricsByDay.values()).sort((a, b) => a.date.localeCompare(b.date)),
    completionEstimate,
    nextSendEstimateAt,
    pendingFollowUpCount,
    nextFollowUpEstimateAt: nextFollowUpEstimateAtInWindow,
  };
}
