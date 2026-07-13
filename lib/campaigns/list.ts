import { prisma } from "@/lib/prisma";
import type { $Enums } from "@/app/generated/prisma/client";

export type CampaignSummary = {
  id: string;
  name: string;
  status: $Enums.CampaignStatus;
  audienceJobTitle: string | null;
  instanceName: string;
  createdByName: string;
  delayMinSec: number;
  delayMaxSec: number;
  dailyCap: number | null;
  allowedWeekdays: number[];
  windowStartHour: number;
  windowEndHour: number;
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

  return campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    audienceJobTitle: c.audienceJobTitle,
    instanceName: c.instance.user.name,
    createdByName: c.createdBy.name,
    delayMinSec: c.delayMinSec,
    delayMaxSec: c.delayMaxSec,
    dailyCap: c.dailyCap,
    allowedWeekdays: c.allowedWeekdays,
    windowStartHour: c.windowStartHour,
    windowEndHour: c.windowEndHour,
    createdAt: c.createdAt,
    counts: countsByCampaign.get(c.id) ?? { pending: 0, sent: 0, failed: 0, skipped: 0, replied: 0 },
  }));
}
