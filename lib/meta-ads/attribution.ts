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
  qualifiedLeads: number;
  unqualifiedLeads: number;
  withWhatsappThread: number;
  whatsappMessagesOutbound: number;
  whatsappMessagesInbound: number;
  whatsappRespondedLeads: number;
  won: number;
  lost: number;
  open: number;
  wonValue: number;
};

export async function getMetaAdsAttribution(organizationId: string): Promise<CampaignAttributionRow[]> {
  const contacts = await prisma.contact.findMany({
    where: { organizationId, metaCampaignId: { not: null } },
    select: {
      id: true,
      metaCampaignId: true,
      metaCampaignName: true,
      leadQualification: true,
      whatsappThreads: { select: { id: true } },
    },
  });
  if (contacts.length === 0) return [];

  const campaignByContactId = new Map(contacts.map((c) => [c.id, { id: c.metaCampaignId!, name: c.metaCampaignName ?? c.metaCampaignId! }]));
  const contactIds = contacts.map((c) => c.id);

  const threads = await prisma.whatsAppThread.findMany({
    where: { organizationId, contactId: { in: contactIds } },
    select: { id: true, contactId: true },
  });
  const threadIds = threads.map((t) => t.id);
  const threadByContactId = new Map<string, string[]>();
  for (const t of threads) {
    if (!t.contactId) continue;
    const arr = threadByContactId.get(t.contactId) ?? [];
    arr.push(t.id);
    threadByContactId.set(t.contactId, arr);
  }

  const messagesByThread = new Map<string, { outbound: number; inbound: number }>();
  if (threadIds.length > 0) {
    const messages = await prisma.whatsAppMessage.groupBy({
      by: ["threadId", "direction"],
      where: { organizationId, threadId: { in: threadIds } },
      _count: { _all: true },
    });
    for (const m of messages) {
      const bucket = messagesByThread.get(m.threadId) ?? { outbound: 0, inbound: 0 };
      if (m.direction === "OUTBOUND") bucket.outbound = m._count._all;
      if (m.direction === "INBOUND") bucket.inbound = m._count._all;
      messagesByThread.set(m.threadId, bucket);
    }
  }

  const deals = await prisma.deal.findMany({
    where: { organizationId, contactId: { in: contactIds } },
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
        qualifiedLeads: 0,
        unqualifiedLeads: 0,
        withWhatsappThread: 0,
        whatsappMessagesOutbound: 0,
        whatsappMessagesInbound: 0,
        whatsappRespondedLeads: 0,
        won: 0,
        lost: 0,
        open: 0,
        wonValue: 0,
      });
    }
    const row = rows.get(campaignId)!;
    row.leads += 1;
    if (contact.leadQualification === "QUALIFIED") row.qualifiedLeads += 1;
    if (contact.leadQualification === "UNQUALIFIED") row.unqualifiedLeads += 1;

    const contactThreadIds = threadByContactId.get(contact.id) ?? [];
    let hasThreadWithInbound = false;
    if (contactThreadIds.length > 0) {
      row.withWhatsappThread += 1;
      for (const tid of contactThreadIds) {
        const cnt = messagesByThread.get(tid);
        if (cnt) {
          row.whatsappMessagesOutbound += cnt.outbound;
          row.whatsappMessagesInbound += cnt.inbound;
          if (cnt.inbound > 0) hasThreadWithInbound = true;
        }
      }
    }
    if (hasThreadWithInbound) row.whatsappRespondedLeads += 1;
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
