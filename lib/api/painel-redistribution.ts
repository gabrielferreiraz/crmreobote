import { z } from "zod";
import type { Prisma } from "@/app/generated/prisma/client";
import { lastOwnerTouch } from "@/lib/lead-claim";
import { classifyPanelLead, loadEligibilityFacts, panelCampaignAuditId, sha256 } from "@/lib/api/painel-lead-eligibility";
import { findMissingRequiredFields, labelForRequiredField } from "@/lib/deal-required-fields";
import { panelPhoneLookupVariants } from "@/lib/api/painel-phone-match";
import { formatBrazilianPhone, parsePhone, resolveContactPhones } from "@/lib/phone-normalize";
import { buildDealName } from "@/lib/deal-name";
import { sanitizeCell } from "@/lib/csv-sanitize";

// A base da campanha saiu do próprio CRM: muitos "não encontrados" indicam
// problema na busca, não contatos novos. O disjuntor para antes de virar lote.
export const MAX_LAST_RESORT_CREATIONS_PER_DAY = 300;
const LAST_RESORT_ACTION = "PANEL_DISTRIBUTION_CREATED";
const NEW_DEAL_ACTION = "PANEL_DISTRIBUTION_NEW_DEAL";

export const panelRedistributionSchema = z.object({
  requestId: z.string().trim().min(1).max(200),
  campaignKey: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(7).max(40),
  actorId: z.string().trim().min(1).max(100),
  ownerId: z.string().trim().min(1).max(100),
  pipelineId: z.string().trim().min(1).max(100),
  stageId: z.string().trim().min(1).max(100),
  dealId: z.string().trim().min(1).max(100).optional(),
  reopenLost: z.boolean().default(false),
  createIfMissing: z.boolean().default(false),
  fallback: z.object({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().max(200).optional(),
    company: z.string().trim().max(200).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    description: z.string().trim().max(10_000).optional(),
  }).optional(),
});

type Input = z.infer<typeof panelRedistributionSchema>;
type Snapshot = { ownerId: string; contactOwnerId: string | null; pipelineId: string; stageId: string; status: string; closedAt?: string | null; lossReasonId?: string | null };
type Result = {
  id: string; contactId: string; outcome: "updated" | "created"; auditId: string; before: Snapshot | null; after: Snapshot;
  contactCreated?: boolean; previousContactOwnerId?: string | null; warnings: string[]; replayed: boolean;
};

export class PanelRedistributionError extends Error {
  constructor(public code: string, message: string, public status = 409, public retryAfter?: Date | null) { super(message); }
}

function fail(code: string, message: string, status = 409, retryAfter?: Date | null): never { throw new PanelRedistributionError(code, message, status, retryAfter); }

/** Busca ampla que só serve para IMPEDIR uma criação: nunca escolhe um cadastro para alterar. */
async function assertNoPossibleContact(tx: Prisma.TransactionClient, organizationId: string, phone: string, name: string, email?: string) {
  const lastDigits = phone.replace(/\D/g, "").slice(-8);
  const possible = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Contact" WHERE "organizationId" = ${organizationId} AND (
      right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 8) = ${lastDigits}
      OR right(regexp_replace(coalesce(whatsapp, ''), '\\D', '', 'g'), 8) = ${lastDigits}
      OR right(coalesce("phoneNormalized", ''), 8) = ${lastDigits}
      OR right(coalesce("whatsappNormalized", ''), 8) = ${lastDigits}
      OR lower(trim(name)) = lower(trim(${name}))
      OR (${email ?? ""} <> '' AND lower(trim(coalesce(email, ''))) = lower(trim(${email ?? ""})))
    ) LIMIT 1`;
  if (possible.length) fail("CONTACT_POSSIBLE_MATCH", "Existe um contato parecido no CRM (mesmo final de telefone, nome ou e-mail). Confira no CRM: nada foi criado.");
}

async function assertCreationBudget(tx: Prisma.TransactionClient, organizationId: string) {
  const created = await tx.auditLog.count({ where: { organizationId, action: LAST_RESORT_ACTION, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
  if (created >= MAX_LAST_RESORT_CREATIONS_PER_DAY) {
    fail("CREATION_LIMIT_REACHED", `Limite de ${MAX_LAST_RESORT_CREATIONS_PER_DAY} criações por dia atingido. Muitos não encontrados podem indicar problema na busca: confira antes de continuar. Nada foi criado.`);
  }
}

/** LAST_RESORT: telefone não encontrado, só com autorização explícita e sob disjuntor. RULE: contato existente e livre pelas regras de elegibilidade, que recebe um negócio novo (o antigo, perdido ou ganho, continua como está). */
async function createDealAsLastResort(tx: Prisma.TransactionClient, organizationId: string, apiKeyName: string, actorName: string, input: Input, stage: { requiredFields: Prisma.PipelineStageGetPayload<object>["requiredFields"] }, existing: { id: string; name: string; source: string | null; jobTitle: string | null; responsavelId: string | null } | null, auditId: (contactId: string) => string, mode: "LAST_RESORT" | "RULE" = "LAST_RESORT"): Promise<Omit<Result, "replayed">> {
  if (mode === "LAST_RESORT") await assertCreationBudget(tx, organizationId);
  const previousOwnerId = existing?.responsavelId ?? null;
  const missing = findMissingRequiredFields(stage.requiredFields, { value: null, grossValue: null, creditType: null, expectedCloseAt: null,
    contactSource: existing?.source ?? `Painel Nichos - ${input.campaignKey}`, contactJobTitle: existing?.jobTitle ?? null });
  const warnings = missing.length ? [`A etapa pede o preenchimento de: ${missing.map(labelForRequiredField).join(", ")}.`] : [];

  let contact = existing;
  if (!contact) {
    if (!input.fallback) fail("CONTACT_NOT_FOUND", "Nenhum contato correspondente foi encontrado no CRM e a solicitação não trouxe os dados para criar. Nada foi criado.", 404);
    // Nunca repetir o incidente de contato criado sem número.
    const parsed = parsePhone(input.phone, "phone");
    const phones = resolveContactPhones({ phone: input.phone });
    if (!parsed.ok || !parsed.phone || parsed.phone.kind === "OTHER" || phones.issues.length || !(phones.phoneNormalized || phones.whatsappNormalized)) {
      fail("PHONE_NOT_CREATABLE", "O contato não foi encontrado e o telefone não é válido para um cadastro novo. Nada foi criado.", 404);
    }
    await assertNoPossibleContact(tx, organizationId, parsed.phone.normalized, input.fallback.name, input.fallback.email);
    const { email, company, city, state } = input.fallback;
    contact = await tx.contact.create({ data: {
      organizationId, name: sanitizeCell(input.fallback.name), tags: [], source: `Painel Nichos - ${input.campaignKey}`, responsavelId: input.ownerId,
      phone: phones.phone, phoneNormalized: phones.phoneNormalized, whatsapp: phones.whatsapp, whatsappNormalized: phones.whatsappNormalized,
      ...(email ? { email: sanitizeCell(email) } : {}), ...(company ? { company: sanitizeCell(company) } : {}),
      ...(city ? { city: sanitizeCell(city) } : {}), ...(state ? { state: sanitizeCell(state) } : {}),
    } });
  } else {
    await tx.contact.update({ where: { id: contact.id }, data: { responsavelId: input.ownerId } });
  }

  const description = input.fallback?.description;
  const deal = await tx.deal.create({ data: {
    organizationId, pipelineId: input.pipelineId, stageId: input.stageId, contactId: contact.id, ownerId: input.ownerId,
    name: sanitizeCell(buildDealName(contact.name, contact.source)), ...(description ? { description: sanitizeCell(description) } : {}),
  } });
  const after: Snapshot = { ownerId: input.ownerId, contactOwnerId: input.ownerId, pipelineId: input.pipelineId, stageId: input.stageId, status: "OPEN" };
  const id = auditId(contact.id);
  const result = { id: deal.id, contactId: contact.id, outcome: "created" as const, auditId: id, before: null, after, contactCreated: !existing, ...(existing ? { previousContactOwnerId: previousOwnerId } : {}), warnings };
  await tx.auditLog.create({ data: { id, organizationId, actorUserId: input.actorId, actorName,
    action: mode === "RULE" ? NEW_DEAL_ACTION : LAST_RESORT_ACTION, targetType: "Deal", targetId: deal.id,
    detail: JSON.stringify({ requestId: input.requestId, campaignKey: input.campaignKey, apiKeyName, result }),
  } });
  await tx.activity.create({ data: { organizationId, dealId: deal.id, contactId: contact.id, userId: input.actorId, type: "SYSTEM",
    body: mode === "RULE"
      ? `Painel Nichos: lead liberado pelas regras da campanha. Negócio novo criado e contato transferido para ${input.ownerId}; os negócios anteriores permanecem como estavam. Auditoria: ${id}.`
      : `Painel Nichos: negócio criado como último recurso, porque ${existing ? "o contato não tinha nenhum negócio" : "o telefone não foi encontrado"} no CRM. Auditoria: ${id}.`,
  } });
  return result;
}

/** A tela e o WhatsApp só leem `phone`/`whatsapp`: contato com número apenas nos campos normalizados chegaria "sem número" ao consultor. Só preenche campo vazio, com o número que o próprio cadastro já tem. */
function visiblePhonesToRestore(contact: { phone: string | null; whatsapp: string | null; phoneNormalized: string | null; whatsappNormalized: string | null }) {
  if (contact.phone?.trim() || contact.whatsapp?.trim()) return null;
  const phone = formatBrazilianPhone(contact.phoneNormalized);
  const whatsapp = formatBrazilianPhone(contact.whatsappNormalized);
  return phone || whatsapp ? { ...(phone ? { phone } : {}), ...(whatsapp ? { whatsapp } : {}) } : null;
}


/** Called only inside a SERIALIZABLE transaction after setTenantOnTx. Quem pode receber o lead é decidido por classifyPanelLead, a mesma regra da checagem em lote. */
export async function redistributeExistingDeal(tx: Prisma.TransactionClient, organizationId: string, apiKeyName: string, input: Input): Promise<Result> {
  const requestHash = sha256(JSON.stringify(input));
  const receiptId = `pn_request_${sha256(`${organizationId}:${input.requestId}`)}`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId + ":" + input.requestId}, 0)) IS NULL AS ignored`;

  // Authorize on EVERY call, including replays. The API key is an integration
  // identity; actorId must still be an active manager/supervisor in this tenant.
  const actor = await tx.organizationUser.findFirst({
    where: { organizationId, userId: input.actorId, active: true },
    include: { user: { select: { name: true } } },
  });
  if (!actor || !["OWNER", "MANAGER", "SUPERVISOR"].includes(actor.role)) fail("ACTOR_NOT_AUTHORIZED", "O solicitante não tem permissão ativa para redistribuir negócios.", 403);
  const target = await tx.organizationUser.findFirst({ where: { organizationId, userId: input.ownerId, active: true, role: "MEMBER", area: "VENDAS" } });
  if (!target) fail("OWNER_NOT_ACTIVE", "O consultor de destino não é um membro ativo de vendas desta organização.", 400);

  // O consultor de destino precisa estar na equipe de quem pede. Os leads, não: quem decide se um lead está livre é a regra de elegibilidade.
  if (actor.role !== "OWNER") {
    const scopeIds = new Set([input.actorId]);
    const teams = await tx.team.findMany({
      where: { organizationId, ...(actor.role === "MANAGER" ? { managerId: input.actorId } : { leaderId: input.actorId }) },
      include: { members: { select: { userId: true } } },
    });
    for (const team of teams) {
      for (const member of team.members) scopeIds.add(member.userId);
      if (team.leaderId) scopeIds.add(team.leaderId);
    }
    if (!scopeIds.has(input.ownerId)) fail("OWNER_OUTSIDE_TEAM", "O consultor de destino não pertence à equipe do solicitante.", 403);
  }

  const previousAudit = await tx.auditLog.findUnique({ where: { id: receiptId } });
  if (previousAudit) {
    const saved = JSON.parse(previousAudit.detail ?? "null") as { requestHash?: string; result?: Result } | null;
    if (previousAudit.organizationId !== organizationId || previousAudit.action !== "PANEL_DISTRIBUTION_RECEIPT" || saved?.requestHash !== requestHash || !saved.result) {
      fail("REQUEST_ID_REUSED", "Esta solicitação já foi usada com outros dados. Confira a auditoria antes de reenviar.");
    }
    return { ...saved!.result!, replayed: true };
  }

  const stage = await tx.pipelineStage.findFirst({ where: { id: input.stageId, pipelineId: input.pipelineId, pipeline: { organizationId } } });
  if (!stage) fail("STAGE_NOT_FOUND", "A etapa de destino não pertence ao funil informado.", 400);

  const variants = panelPhoneLookupVariants(input.phone);
  if (!variants.length) fail("PHONE_NOT_SEARCHABLE", "Não foi possível interpretar o telefone para localizar o cadastro original.", 400);
  const matchWhere = { organizationId, OR: [
    { phoneNormalized: { in: variants } }, { whatsappNormalized: { in: variants } },
    { phone: { in: variants } }, { whatsapp: { in: variants } },
  ] };
  const matches = await tx.contact.findMany({ where: matchWhere, select: { id: true, name: true, responsavelId: true }, orderBy: { id: "asc" }, take: 20 });
  const campaignAuditId = (id: string) => panelCampaignAuditId(organizationId, input.campaignKey, id);
  // Um dealId conhecido que sumiu foi removido de propósito: nunca recriar.
  const mayCreate = input.createIfMissing && !input.dealId;
  const finishCreation = async (created: Omit<Result, "replayed">): Promise<Result> => {
    const result: Result = { ...created, replayed: false };
    await tx.auditLog.create({ data: { id: receiptId, organizationId, actorUserId: input.actorId, actorName: actor!.user.name,
      action: "PANEL_DISTRIBUTION_RECEIPT", targetType: "Deal", targetId: result.id,
      detail: JSON.stringify({ requestId: input.requestId, requestHash, result }),
    } });
    return result;
  };
  if (matches.length === 0) {
    if (mayCreate) return finishCreation(await createDealAsLastResort(tx, organizationId, apiKeyName, actor.user.name, input, stage, null, campaignAuditId));
    fail("CONTACT_NOT_FOUND", "Nenhum contato correspondente foi encontrado no CRM. O cadastro original precisa ser conferido; nenhum contato novo foi criado.", 404);
  }

  // Todos os cadastros do telefone contam: se qualquer um já passou nesta campanha, o lead não volta.
  let campaignDistributed = false;
  for (const match of matches) {
    await tx.$queryRaw`SELECT id FROM "Contact" WHERE id = ${match.id} AND "organizationId" = ${organizationId} FOR UPDATE`;
    if (await tx.auditLog.findUnique({ where: { id: campaignAuditId(match.id) } })) campaignDistributed = true;
  }

  // Lido depois do bloqueio das linhas: a decisão vale para o estado que será gravado.
  const facts = await loadEligibilityFacts(tx, organizationId, matches);
  const decision = await classifyPanelLead({
    contacts: matches, deals: facts.deals, activeUserIds: facts.activeUserIds, pipelineId: input.pipelineId, campaignDistributed,
    dealId: input.dealId, leadName: input.fallback?.name, lastTouch: (contactId, ownerId) => lastOwnerTouch(tx, organizationId, contactId, ownerId),
  });
  if (!decision.free) fail(decision.code, decision.reason, decision.code === "DEAL_NOT_FOUND" ? 404 : 409, decision.retryAfter);
  if (decision.action === "NEW") fail("CONTACT_CHANGED", "O contato mudou durante a consulta. Confira o cadastro e tente novamente.");

  const contactId = decision.contactId;
  const contact = await tx.contact.findFirst({ where: { id: contactId, organizationId } });
  if (!contact) fail("CONTACT_CHANGED", "O contato mudou durante a consulta. Confira o cadastro e tente novamente.");
  const restoredPhones = visiblePhonesToRestore(contact);
  if (restoredPhones) {
    await tx.contact.update({ where: { id: contactId }, data: restoredPhones });
    await tx.auditLog.create({ data: { organizationId, actorUserId: input.actorId, actorName: actor.user.name,
      action: "PANEL_DISTRIBUTION_PHONE_RESTORED", targetType: "Contact", targetId: contactId,
      detail: JSON.stringify({ requestId: input.requestId, fields: Object.keys(restoredPhones) }),
    } });
  }
  const auditId = campaignAuditId(contactId);

  // Contato livre sem negócio aberto no funil: negócio novo. O histórico (perdido ou ganho de consultor inativo) fica como está.
  if (decision.action === "NEW_DEAL") {
    return finishCreation(await createDealAsLastResort(tx, organizationId, apiKeyName, actor.user.name, input, stage, contact, campaignAuditId, "RULE"));
  }

  await tx.$queryRaw`SELECT id FROM "Deal" WHERE id = ${decision.dealId} AND "organizationId" = ${organizationId} FOR UPDATE`;
  const deal = await tx.deal.findFirst({ where: { id: decision.dealId, organizationId, contactId, pipelineId: input.pipelineId } });
  if (!deal || deal.status !== "OPEN") fail("DEAL_CHANGED", "O negócio mudou. Confira o cadastro antes de continuar.");

  const warnings: string[] = [];
  const missing = findMissingRequiredFields(stage.requiredFields, { value: deal.value, grossValue: deal.grossValue, creditType: deal.creditType,
    expectedCloseAt: deal.expectedCloseAt, contactSource: contact.source, contactJobTitle: contact.jobTitle });
  // O lead sempre entra na etapa da campanha. Nada é inventado: o consultor preenche o que faltar.
  if (missing.length) warnings.push(`A etapa pede o preenchimento de: ${missing.map(labelForRequiredField).join(", ")}.`);
  const stageId = input.stageId;

  const before: Snapshot = { ownerId: deal.ownerId, contactOwnerId: contact.responsavelId, pipelineId: deal.pipelineId, stageId: deal.stageId, status: deal.status, closedAt: deal.closedAt?.toISOString() ?? null, lossReasonId: deal.lossReasonId };
  const after: Snapshot = { ownerId: input.ownerId, contactOwnerId: input.ownerId, pipelineId: input.pipelineId, stageId, status: "OPEN" };
  await tx.deal.update({ where: { id: deal.id }, data: {
    ownerId: input.ownerId, stageId, ...(deal.stageId !== stageId ? { stageEnteredAt: new Date() } : {}),
  } });
  await tx.contact.update({ where: { id: contactId }, data: { responsavelId: input.ownerId } });
  if (deal.ownerId !== input.ownerId) await tx.dealParticipant.deleteMany({ where: { dealId: deal.id, userId: input.ownerId } });
  const result: Result = { id: deal.id, contactId, outcome: "updated", auditId, before, after, warnings, replayed: false };
  await tx.auditLog.create({ data: { id: auditId, organizationId, actorUserId: input.actorId, actorName: actor.user.name,
    action: "PANEL_DISTRIBUTION_UPDATED", targetType: "Deal", targetId: deal.id,
    detail: JSON.stringify({ requestId: input.requestId, campaignKey: input.campaignKey, apiKeyName, result }),
  } });
  await tx.auditLog.create({ data: { id: receiptId, organizationId, actorUserId: input.actorId, actorName: actor.user.name,
    action: "PANEL_DISTRIBUTION_RECEIPT", targetType: "Deal", targetId: deal.id,
    detail: JSON.stringify({ requestId: input.requestId, requestHash, result }),
  } });
  await tx.activity.create({ data: { organizationId, dealId: deal.id, contactId, userId: input.actorId, type: "SYSTEM",
    body: `Painel Nichos: redistribuiu o negócio e o contato para ${input.ownerId}; etapa ${deal.stageId} → ${stageId}. Auditoria: ${auditId}.`,
  } });
  return result;
}
