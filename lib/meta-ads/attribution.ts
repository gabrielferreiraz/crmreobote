/**
 * Relatório de conversão por campanha — a pergunta que motivou a
 * integração inteira: "quais anúncios deram negócio ganho, e quais não".
 * Duas fontes de "isso veio de anúncio", combinadas na mesma tabela:
 *
 * 1. metaCampaignId preenchido (ver Contact em prisma/schema.prisma) — veio
 *    de verdade pelo formulário nativo/webhook de Lead Ads
 *    (lib/meta-ads/leads.ts), com campanha/anúncio/conjunto reais da Meta.
 * 2. Contact.source bate com uma LeadSource marcada countsAsAd=true (ver
 *    Configurações → Origens) — marcação manual, pro administrativo poder
 *    contar lead antigo (de antes dessa integração existir) ou lead que
 *    veio de anúncio por um caminho que não é o formulário nativo. Essas
 *    entram como uma "campanha" sintética por origem (campaignId
 *    `manual:<origem>`, isManual: true na linha) — sem dado real de
 *    campanha/anúncio da Meta, só agrupadas pelo texto da Origem mesmo.
 *
 * Não consulta a Marketing API de novo — tudo já está gravado no contato
 * no momento em que o lead chegou (ou foi marcado manualmente).
 */

import { prisma } from "@/lib/prisma";

export type CampaignAttributionRow = {
  campaignId: string;
  campaignName: string;
  /** true = veio da marcação manual de Origem (ver acima), não de um lead real do Facebook/Instagram. */
  isManual: boolean;
  leads: number;
  qualifiedLeads: number;
  unqualifiedLeads: number;
  withWhatsappThread: number;
  whatsappMessagesOutbound: number;
  whatsappMessagesInbound: number;
  whatsappRespondedLeads: number;
  /** Teve conversa iniciada no WhatsApp mas nunca respondeu nada (withWhatsappThread menos whatsappRespondedLeads) — não inclui quem nunca chegou a ter conversa iniciada. */
  noResponseLeads: number;
  /** Ao menos uma Activity tipo Reunião/Visita com outcome ATTENDED (ou sem outcome registrado — histórico anterior à essa coluna existir, ver ActivityMeetingOutcome no schema). */
  meetingLeads: number;
  /** Ao menos uma Activity tipo Reunião/Visita com outcome NO_SHOW — não é mutuamente exclusivo com meetingLeads (um lead pode ter levado um no-show e depois comparecido numa remarcação). */
  noShowLeads: number;
  won: number;
  lost: number;
  open: number;
  wonValue: number;
};

/**
 * `period`: filtra por Contact.createdAt (quando o LEAD entrou) — não pela
 * data em que o negócio fechou. De propósito: um lead que chegou este mês e
 * só fecha o próximo continua contando no mês em que CHEGOU (é o mês em que
 * o gasto de anúncio que trouxe ele foi feito) — filtrar por data de
 * fechamento em vez disso subcontaria conversão de lead recente, ainda em
 * andamento. Sem `period`: comportamento de sempre, todo contato atribuído
 * desde sempre.
 */
export async function getMetaAdsAttribution(
  organizationId: string,
  period?: { since: Date; until: Date },
): Promise<CampaignAttributionRow[]> {
  const adSources = await prisma.leadSource.findMany({
    where: { organizationId, countsAsAd: true },
    select: { label: true },
  });
  const adSourceLabels = adSources.map((s) => s.label);

  const contacts = await prisma.contact.findMany({
    where: {
      organizationId,
      OR: [{ metaCampaignId: { not: null } }, ...(adSourceLabels.length > 0 ? [{ source: { in: adSourceLabels } }] : [])],
      ...(period ? { createdAt: { gte: period.since, lte: period.until } } : {}),
    },
    select: {
      id: true,
      source: true,
      metaCampaignId: true,
      metaCampaignName: true,
      leadQualification: true,
      whatsappThreads: { select: { id: true } },
    },
  });
  if (contacts.length === 0) return [];

  // Campanha real (metaCampaignId) tem prioridade — um contato só cai no
  // balde "manual" quando não tem atribuição de verdade da Meta.
  const campaignByContactId = new Map(
    contacts.map((c) =>
      c.metaCampaignId
        ? [c.id, { id: c.metaCampaignId, name: c.metaCampaignName ?? c.metaCampaignId, isManual: false }]
        : [c.id, { id: `manual:${c.source}`, name: c.source ?? "Origem sem nome", isManual: true }],
    ),
  );
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

  // Reunião/visita já realizada (Activity, não Task — Task é o agendamento,
  // Activity é o "aconteceu de fato", mesma fonte que o resto de Relatórios
  // usa pro ranking de reuniões). Sem filtro de data aqui de propósito: um
  // lead que entrou este mês mas só teve a reunião marcada semana que vem
  // continua contando pra esse período (mesmo raciocínio do won/lost acima,
  // não filtrar por closedAt). Busca TODAS as linhas (não só contactId
  // distinct) porque precisa do outcome de cada uma pra separar
  // compareceu/no-show — um contato pode ter mais de uma Activity dessas
  // (ex.: no-show numa data, compareceu na remarcação).
  const meetingActivities = await prisma.activity.findMany({
    where: { organizationId, contactId: { in: contactIds }, type: { in: ["MEETING", "VISIT"] } },
    select: { contactId: true, meetingOutcome: true },
  });
  const meetingContactIds = new Set<string>();
  const noShowContactIds = new Set<string>();
  for (const a of meetingActivities) {
    if (!a.contactId) continue;
    // null = histórico anterior à coluna existir — tratado como
    // "compareceu" (ver comentário no schema), nunca como no-show.
    if (a.meetingOutcome === "NO_SHOW") noShowContactIds.add(a.contactId);
    else if (a.meetingOutcome !== "RESCHEDULED") meetingContactIds.add(a.contactId);
  }

  const rows = new Map<string, CampaignAttributionRow>();
  for (const contact of contacts) {
    const campaign = campaignByContactId.get(contact.id)!;
    const campaignId = campaign.id;
    if (!rows.has(campaignId)) {
      rows.set(campaignId, {
        campaignId,
        campaignName: campaign.name,
        isManual: campaign.isManual,
        leads: 0,
        qualifiedLeads: 0,
        unqualifiedLeads: 0,
        withWhatsappThread: 0,
        whatsappMessagesOutbound: 0,
        whatsappMessagesInbound: 0,
        whatsappRespondedLeads: 0,
        noResponseLeads: 0,
        meetingLeads: 0,
        noShowLeads: 0,
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
    if (meetingContactIds.has(contact.id)) row.meetingLeads += 1;
    if (noShowContactIds.has(contact.id)) row.noShowLeads += 1;

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

  // noResponseLeads é derivado (nunca acumulado direto no loop acima) —
  // "teve conversa iniciada mas nunca respondeu nada", não "nunca teve
  // conversa nenhuma" (esse último não é o mesmo problema: um é "sumiu", o
  // outro é "nem foi abordado ainda").
  for (const row of rows.values()) {
    row.noResponseLeads = row.withWhatsappThread - row.whatsappRespondedLeads;
  }

  return Array.from(rows.values()).sort((a, b) => b.leads - a.leads);
}
