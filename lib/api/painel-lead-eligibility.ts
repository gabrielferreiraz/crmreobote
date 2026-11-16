import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/app/generated/prisma/client";
import { lostLeadReleaseCutoff } from "@/lib/lead-claim";
import { panelPhoneLookupVariants } from "@/lib/api/painel-phone-match";

/**
 * REGRA ÚNICA de "este lead da campanha pode ir para um consultor?". A checagem em lote
 * (o Painel pergunta antes de reservar) e a gravação (redistributeExistingDeal) usam
 * esta mesma função, então nunca discordam. Quem decide é o CRM; o Painel só obedece.
 *
 *  - Não existe no CRM ........................................ livre, entra como contato novo (último recurso)
 *  - Negócio ABERTO de consultor ativo ........................ bloqueado
 *  - Negócio GANHO (cliente) de consultor ativo ............... bloqueado
 *  - Negócio aberto/ganho de consultor inativo ................ livre: aberto é transferido, ganho segue intacto
 *  - Perdido, responsável ativo, há menos de 3 meses .......... bloqueado (o prazo recomeça se ele mexeu no lead)
 *  - Perdido, responsável ativo, há mais de 3 meses ........... livre, negócio novo
 *  - Perdido, responsável inativo ............................. livre, negócio novo
 *  - Contato de responsável ativo, sem negócio ................ bloqueado
 *  - Todo caso livre troca o responsável do contato e do negócio para o consultor escolhido.
 */
const DAY_MS = 86_400_000;
const RETRY_DAYS = { OPEN: 30, CLIENT: 90, OWNER: 30 } as const;
export const MAX_ELIGIBILITY_PHONES = 200;

export type EligibilityContact = { id: string; name: string; responsavelId: string | null };
export type EligibilityDeal = { id: string; contactId: string; pipelineId: string; status: string; ownerId: string; closedAt: Date | null; updatedAt: Date };
export type Eligibility =
  | { free: true; action: "NEW" }
  | { free: true; action: "TRANSFER"; contactId: string; dealId: string }
  | { free: true; action: "NEW_DEAL"; contactId: string }
  | { free: false; code: string; reason: string; retryAfter: Date | null };

const blocked = (code: string, reason: string, retryAfter: Date | null): Eligibility => ({ free: false, code, reason, retryAfter });
const addMonthsPlusDay = (date: Date) => { const next = new Date(date); next.setMonth(next.getMonth() + 3); return new Date(next.getTime() + DAY_MS); };

export async function classifyPanelLead(input: {
  contacts: EligibilityContact[]; deals: EligibilityDeal[]; activeUserIds: Set<string>; pipelineId: string;
  campaignDistributed: boolean; dealId?: string; leadName?: string; now?: Date;
  lastTouch: (contactId: string, ownerId: string) => Promise<Date | null>;
}): Promise<Eligibility> {
  const now = input.now ?? new Date();
  const { contacts, deals } = input;
  if (contacts.length === 0) return { free: true, action: "NEW" };
  if (input.campaignDistributed) return blocked("CONTACT_ALREADY_DISTRIBUTED", "Este contato já foi redistribuído nesta campanha, possivelmente por outro formato do mesmo telefone.", null);

  const active = (id: string | null | undefined): id is string => !!id && input.activeUserIds.has(id);
  const inDays = (days: number) => new Date(now.getTime() + days * DAY_MS);

  if (deals.some(deal => deal.status === "OPEN" && active(deal.ownerId))) {
    return blocked("BLOCKED_OPEN_ACTIVE", "O lead está em andamento com um consultor ativo.", inDays(RETRY_DAYS.OPEN));
  }
  if (deals.some(deal => deal.status === "WON" && active(deal.ownerId))) {
    return blocked("BLOCKED_CLIENT_ACTIVE", "O lead é cliente (negócio ganho) de um consultor ativo.", inDays(RETRY_DAYS.CLIENT));
  }

  const cutoff = lostLeadReleaseCutoff(now);
  for (const contact of contacts) {
    const own = deals.filter(deal => deal.contactId === contact.id);
    const hasOpenOrWon = own.some(deal => deal.status === "OPEN" || deal.status === "WON");
    if (active(contact.responsavelId) && (own.length === 0 || hasOpenOrWon)) {
      return blocked("BLOCKED_OWNER_ACTIVE", "O contato pertence a um consultor ativo.", inDays(RETRY_DAYS.OWNER));
    }
    const lost = own.filter(deal => deal.status === "LOST");
    if (hasOpenOrWon || lost.length === 0) continue;
    const latest = lost.reduce((best, deal) => ((deal.closedAt?.getTime() ?? -Infinity) > (best.closedAt?.getTime() ?? -Infinity) ? deal : best));
    for (const owner of new Set([latest.ownerId, contact.responsavelId].filter(active))) {
      if (!latest.closedAt) return blocked("BLOCKED_LOST_RECENT", "O lead foi perdido por um consultor ativo e não há data da perda para conferir o prazo.", inDays(RETRY_DAYS.OWNER));
      if (latest.closedAt > cutoff) return blocked("BLOCKED_LOST_RECENT", "O lead foi perdido há menos de 3 meses por um consultor ativo.", addMonthsPlusDay(latest.closedAt));
      const touched = await input.lastTouch(contact.id, owner);
      if (touched && touched > cutoff) return blocked("BLOCKED_LOST_RECENT", "O consultor responsável trabalhou o lead nos últimos 3 meses.", addMonthsPlusDay(touched));
    }
  }

  // Livre. Escolhe sozinho: mesmo nome da planilha, depois o cadastro com o negócio mais recente.
  let candidates = contacts;
  if (input.dealId) {
    const known = deals.find(deal => deal.id === input.dealId);
    if (!known) return blocked("DEAL_NOT_FOUND", "O negócio informado não pertence aos cadastros deste telefone. Nada foi alterado.", null);
    candidates = contacts.filter(contact => contact.id === known.contactId);
  }
  const normalize = (value: string) => value.trim().toLowerCase();
  const sameName = new Set(input.leadName ? candidates.filter(contact => normalize(contact.name) === normalize(input.leadName!)).map(contact => contact.id) : []);
  // Com o mesmo nome da planilha, só esse cadastro concorre.
  if (sameName.size) candidates = candidates.filter(contact => sameName.has(contact.id));
  const ordered = [...deals].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const open = ordered.filter(deal => deal.status === "OPEN" && deal.pipelineId === input.pipelineId && candidates.some(contact => contact.id === deal.contactId) && (!input.dealId || deal.id === input.dealId));
  const openChoice = open.find(deal => sameName.has(deal.contactId)) ?? open[0];
  if (openChoice) return { free: true, action: "TRANSFER", contactId: openChoice.contactId, dealId: openChoice.id };
  const contactChoice = candidates.find(contact => sameName.has(contact.id))
    ?? candidates.find(contact => ordered.some(deal => deal.contactId === contact.id)) ?? candidates[0];
  return { free: true, action: "NEW_DEAL", contactId: contactChoice.id };
}

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
/** Mesmo ID para a gravação e para a checagem: um contato só passa uma vez por campanha. */
export const panelCampaignAuditId = (organizationId: string, campaignKey: string, contactId: string) => `pn_campaign_${sha256(`${organizationId}:${campaignKey}:${contactId}`)}`;

type FactsClient = Pick<Prisma.TransactionClient, "deal" | "organizationUser">;

/** Negócios de TODOS os funis e status dos contatos, e quais responsáveis seguem ativos. */
export async function loadEligibilityFacts(db: FactsClient, organizationId: string, contacts: EligibilityContact[]) {
  const deals: EligibilityDeal[] = contacts.length
    ? await db.deal.findMany({
      where: { organizationId, contactId: { in: contacts.map(contact => contact.id) }, status: { in: ["OPEN", "WON", "LOST"] } },
      select: { id: true, contactId: true, pipelineId: true, status: true, ownerId: true, closedAt: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    })
    : [];
  const userIds = [...new Set([...deals.map(deal => deal.ownerId), ...contacts.flatMap(contact => contact.responsavelId ? [contact.responsavelId] : [])])];
  const members = userIds.length ? await db.organizationUser.findMany({ where: { organizationId, userId: { in: userIds }, active: true }, select: { userId: true } }) : [];
  return { deals, activeUserIds: new Set(members.map(member => member.userId)) };
}

export const panelEligibilitySchema = z.object({
  campaignKey: z.string().trim().min(1).max(100),
  pipelineId: z.string().trim().min(1).max(100),
  phones: z.array(z.string().trim().max(40)).min(1).max(MAX_ELIGIBILITY_PHONES),
});

export type EligibilityAnswer = { index: number; phone: string; free: boolean; action?: string; code?: string; reason?: string; retryAfter?: string | null };

type CheckClient = FactsClient & Pick<Prisma.TransactionClient, "contact" | "auditLog">;

/** Somente leitura. Responde, para cada telefone, "pode ir para um consultor?" com as mesmas regras da gravação. */
export async function checkPanelLeads(db: CheckClient, organizationId: string, input: z.infer<typeof panelEligibilitySchema>, lastTouch: (contactId: string, ownerId: string) => Promise<Date | null>): Promise<EligibilityAnswer[]> {
  const variantsByPhone = input.phones.map(phone => panelPhoneLookupVariants(phone));
  const phoneIndexesByVariant = new Map<string, number[]>();
  variantsByPhone.forEach((variants, index) => variants.forEach(variant => phoneIndexesByVariant.set(variant, [...(phoneIndexesByVariant.get(variant) ?? []), index])));
  const allVariants = [...phoneIndexesByVariant.keys()];
  const rows = allVariants.length ? await db.contact.findMany({
    where: { organizationId, OR: [{ phoneNormalized: { in: allVariants } }, { whatsappNormalized: { in: allVariants } }, { phone: { in: allVariants } }, { whatsapp: { in: allVariants } }] },
    select: { id: true, name: true, responsavelId: true, phone: true, whatsapp: true, phoneNormalized: true, whatsappNormalized: true },
    orderBy: { id: "asc" },
  }) : [];

  const contactsByPhone = input.phones.map(() => new Map<string, EligibilityContact>());
  for (const row of rows) {
    for (const value of [row.phone, row.whatsapp, row.phoneNormalized, row.whatsappNormalized]) {
      for (const index of value ? phoneIndexesByVariant.get(value) ?? [] : []) {
        if (contactsByPhone[index].size < 20) contactsByPhone[index].set(row.id, { id: row.id, name: row.name, responsavelId: row.responsavelId });
      }
    }
  }
  const allContacts = [...new Map(contactsByPhone.flatMap(map => [...map.values()]).map(contact => [contact.id, contact])).values()];
  const [facts, distributed] = await Promise.all([
    loadEligibilityFacts(db, organizationId, allContacts),
    allContacts.length ? db.auditLog.findMany({ where: { id: { in: allContacts.map(contact => panelCampaignAuditId(organizationId, input.campaignKey, contact.id)) } }, select: { id: true } }) : [],
  ]);
  const distributedIds = new Set(distributed.map(audit => audit.id));

  const answers: EligibilityAnswer[] = [];
  for (const [index, phone] of input.phones.entries()) {
    if (!variantsByPhone[index].length) { answers.push({ index, phone, free: false, code: "PHONE_NOT_SEARCHABLE", reason: "Telefone inválido para busca.", retryAfter: null }); continue; }
    const contacts = [...contactsByPhone[index].values()];
    const ids = new Set(contacts.map(contact => contact.id));
    const decision = await classifyPanelLead({
      contacts, deals: facts.deals.filter(deal => ids.has(deal.contactId)), activeUserIds: facts.activeUserIds, pipelineId: input.pipelineId,
      campaignDistributed: contacts.some(contact => distributedIds.has(panelCampaignAuditId(organizationId, input.campaignKey, contact.id))), lastTouch,
    });
    answers.push(decision.free
      ? { index, phone, free: true, action: decision.action }
      : { index, phone, free: false, code: decision.code, reason: decision.reason, retryAfter: decision.retryAfter?.toISOString() ?? null });
  }
  return answers;
}
