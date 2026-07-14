import { prisma } from "@/lib/prisma";
import type { $Enums } from "@/app/generated/prisma/client";
import { parseAudienceFilter, describeAudienceFilter, type AudienceFilter } from "@/lib/campaigns/audience";
import { brazilDateKey } from "@/lib/timezone";

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
  status: $Enums.CampaignRecipientStatus;
  sentAt: Date | null;
  repliedAt: Date | null;
  followUpSentAt: Date | null;
  error: string | null;
};

/** Um ponto do gráfico do painel de métricas — um dia (calendário de Brasília), quantos envios e quantas respostas. */
export type CampaignDailyMetric = { date: string; sent: number; replied: number };

export type CampaignDetail = CampaignSummary & { recipients: CampaignRecipientRow[]; dailyMetrics: CampaignDailyMetric[] };

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
        include: { contact: { select: { name: true, whatsapp: true, phone: true } } },
      },
    },
  });
  if (!campaign) return null;

  const counts = { pending: 0, sent: 0, failed: 0, skipped: 0, replied: 0 };
  const metricsByDay = new Map<string, CampaignDailyMetric>();
  const bump = (date: Date, field: "sent" | "replied") => {
    const key = brazilDateKey(date);
    const entry = metricsByDay.get(key) ?? { date: key, sent: 0, replied: 0 };
    entry[field] += 1;
    metricsByDay.set(key, entry);
  };

  for (const r of campaign.recipients) {
    if (r.status === "PENDING") counts.pending += 1;
    if (r.status === "SENT") counts.sent += 1;
    if (r.status === "FAILED") counts.failed += 1;
    if (r.status === "SKIPPED") counts.skipped += 1;
    if (r.repliedAt) counts.replied += 1;
    if (r.sentAt) bump(r.sentAt, "sent");
    if (r.repliedAt) bump(r.repliedAt, "replied");
  }

  const audienceFilter = parseAudienceFilter(campaign.audienceFilter);

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
      status: r.status,
      sentAt: r.sentAt,
      repliedAt: r.repliedAt,
      followUpSentAt: r.followUpSentAt,
      error: r.error ?? r.followUpError,
    })),
    dailyMetrics: Array.from(metricsByDay.values()).sort((a, b) => a.date.localeCompare(b.date)),
  };
}
