/**
 * Relatório de conversão por campanha — a pergunta que motivou a
 * integração inteira: "quais anúncios deram negócio ganho, e quais não".
 * Agrupa por metaCampaignId (ver Contact em prisma/schema.prisma) em vez de
 * consultar a Marketing API de novo — os dados já estão aqui, gravados no
 * momento em que o lead chegou (lib/meta-ads/leads.ts).
 */

import { prisma } from "@/lib/prisma";

export type CampaignAttributionRow = {
  campaignId: string;
  campaignName: string;
  leads: number;
  won: number;
  lost: number;
  open: number;
  wonValue: number;
};

export async function getMetaAdsAttribution(organizationId: string): Promise<CampaignAttributionRow[]> {
  const contacts = await prisma.contact.findMany({
    where: { organizationId, metaCampaignId: { not: null } },
    select: { id: true, metaCampaignId: true, metaCampaignName: true },
  });
  if (contacts.length === 0) return [];

  const campaignByContactId = new Map(contacts.map((c) => [c.id, { id: c.metaCampaignId!, name: c.metaCampaignName ?? c.metaCampaignId! }]));

  const deals = await prisma.deal.findMany({
    where: { organizationId, contactId: { in: contacts.map((c) => c.id) } },
    select: { contactId: true, status: true, value: true },
  });

  const rows = new Map<string, CampaignAttributionRow>();
  for (const contact of contacts) {
    const campaignId = contact.metaCampaignId!;
    if (!rows.has(campaignId)) {
      rows.set(campaignId, {
        campaignId,
        campaignName: contact.metaCampaignName ?? campaignId,
        leads: 0,
        won: 0,
        lost: 0,
        open: 0,
        wonValue: 0,
      });
    }
    rows.get(campaignId)!.leads += 1;
  }

  for (const deal of deals) {
    const campaign = campaignByContactId.get(deal.contactId);
    if (!campaign) continue;
    const row = rows.get(campaign.id);
    if (!row) continue;

    if (deal.status === "WON") {
      row.won += 1;
      row.wonValue += deal.value != null ? Number(deal.value) : 0;
    } else if (deal.status === "LOST") {
      row.lost += 1;
    } else {
      row.open += 1;
    }
  }

  return Array.from(rows.values()).sort((a, b) => b.leads - a.leads);
}
