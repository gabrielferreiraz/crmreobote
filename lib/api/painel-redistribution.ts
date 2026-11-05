import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/app/generated/prisma/client";
import { evaluateLeadClaim } from "@/lib/lead-claim";
import { findMissingRequiredFields, labelForRequiredField } from "@/lib/deal-required-fields";
import { panelPhoneLookupVariants } from "@/lib/api/painel-phone-match";

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
});

type Input = z.infer<typeof panelRedistributionSchema>;
type Snapshot = { ownerId: string; contactOwnerId: string | null; pipelineId: string; stageId: string; status: string };
type Result = { id: string; contactId: string; outcome: "updated"; auditId: string; before: Snapshot; after: Snapshot; warnings: string[]; replayed: boolean };

export class PanelRedistributionError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}

function fail(code: string, message: string, status = 409): never { throw new PanelRedistributionError(code, message, status); }

/** Called only inside a SERIALIZABLE transaction after setTenantOnTx. No create/upsert of Contact or Deal. */
export async function redistributeExistingDeal(tx: Prisma.TransactionClient, organizationId: string, apiKeyName: string, input: Input): Promise<Result> {
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const requestHash = hash(JSON.stringify(input));
  const receiptId = `pn_request_${hash(`${organizationId}:${input.requestId}`)}`;
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

  const scopeIds = new Set([input.actorId]);
  if (actor.role !== "OWNER") {
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
  const matches = await tx.contact.findMany({ where: matchWhere, select: { id: true }, take: 2 });
  if (matches.length === 0) fail("CONTACT_NOT_FOUND", "Nenhum contato correspondente foi encontrado no CRM. O cadastro original precisa ser conferido; nenhum contato novo foi criado.", 404);
  if (matches.length !== 1) fail("CONTACT_AMBIGUOUS", "Mais de um contato corresponde a esse número. Confira os cadastros no CRM antes de escolher qual redistribuir.");

  const contactId = matches[0].id;
  await tx.$queryRaw`SELECT id FROM "Contact" WHERE id = ${contactId} AND "organizationId" = ${organizationId} FOR UPDATE`;
  const contact = await tx.contact.findFirst({ where: { id: contactId, organizationId } });
  if (!contact) fail("CONTACT_CHANGED", "O contato mudou durante a consulta. Confira o cadastro e tente novamente.");
  const auditId = `pn_campaign_${hash(`${organizationId}:${input.campaignKey}:${contactId}`)}`;
  if (await tx.auditLog.findUnique({ where: { id: auditId } })) {
    fail("CONTACT_ALREADY_DISTRIBUTED", "Este contato já foi redistribuído nesta campanha, possivelmente por outro formato do mesmo telefone. Confira a auditoria antes de transferir novamente.");
  }

  const deals = await tx.deal.findMany({
    where: { organizationId, contactId, pipelineId: input.pipelineId, status: { in: ["OPEN", "LOST"] }, ...(input.dealId ? { id: input.dealId } : {}) },
    select: { id: true }, take: 2,
  });
  if (!deals.length) fail("DEAL_NOT_FOUND", "Não foi encontrado um negócio aberto ou perdido deste contato no funil selecionado. Nenhum negócio novo foi criado.", 404);
  if (deals.length !== 1) fail("DEAL_AMBIGUOUS", "O contato possui vários negócios no funil selecionado. Confira no CRM qual negócio deve ser redistribuído.");
  await tx.$queryRaw`SELECT id FROM "Deal" WHERE id = ${deals[0].id} AND "organizationId" = ${organizationId} FOR UPDATE`;
  const deal = await tx.deal.findFirst({ where: { id: deals[0].id, organizationId, contactId, pipelineId: input.pipelineId } });
  if (!deal || deal.status === "WON") fail("DEAL_CHANGED", "O negócio mudou ou está ganho. Confira o cadastro antes de continuar.");
  if (deal.status === "LOST" && !input.reopenLost) fail("REOPEN_REQUIRED", "O negócio está perdido. Autorize a reabertura na solicitação para movê-lo para a campanha.");

  if (actor.role !== "OWNER" && (!scopeIds.has(deal.ownerId) || (contact.responsavelId && !scopeIds.has(contact.responsavelId)))) {
    const claim = await evaluateLeadClaim(organizationId, contactId, contact.responsavelId, tx);
    if (!claim.claimReason) fail("CURRENT_OWNER_OUTSIDE_TEAM", "Este cadastro pertence a um responsável ativo de outra equipe. A transferência precisa ser autorizada no CRM.", 403);
  }
  const otherActiveDeal = await tx.deal.findFirst({ where: { organizationId, contactId, id: { not: deal.id }, status: { in: ["OPEN", "WON"] }, ownerId: { not: input.ownerId } }, select: { id: true } });
  if (otherActiveDeal) fail("OTHER_ACTIVE_DEAL", "Este contato tem outro negócio aberto ou ganho com outro responsável. Confira a transferência no CRM antes de continuar.");

  const missing = findMissingRequiredFields(stage.requiredFields, { value: deal.value, grossValue: deal.grossValue, creditType: deal.creditType,
    expectedCloseAt: deal.expectedCloseAt, contactSource: contact.source, contactJobTitle: contact.jobTitle });
  if (missing.length) fail("STAGE_REQUIRED_FIELDS", `A etapa exige o preenchimento de: ${missing.map(labelForRequiredField).join(", ")}.`, 400);

  const before: Snapshot = { ownerId: deal.ownerId, contactOwnerId: contact.responsavelId, pipelineId: deal.pipelineId, stageId: deal.stageId, status: deal.status };
  const after: Snapshot = { ownerId: input.ownerId, contactOwnerId: input.ownerId, pipelineId: input.pipelineId, stageId: input.stageId, status: "OPEN" };
  await tx.deal.update({ where: { id: deal.id }, data: {
    ownerId: input.ownerId, stageId: input.stageId, status: "OPEN",
    ...(deal.stageId !== input.stageId || deal.status !== "OPEN" ? { stageEnteredAt: new Date() } : {}),
  } });
  await tx.contact.update({ where: { id: contactId }, data: { responsavelId: input.ownerId } });
  if (deal.ownerId !== input.ownerId) await tx.dealParticipant.deleteMany({ where: { dealId: deal.id, userId: input.ownerId } });
  const result: Result = { id: deal.id, contactId, outcome: "updated", auditId, before, after, warnings: [], replayed: false };
  await tx.auditLog.create({ data: { id: auditId, organizationId, actorUserId: input.actorId, actorName: actor.user.name,
    action: "PANEL_DISTRIBUTION_UPDATED", targetType: "Deal", targetId: deal.id,
    detail: JSON.stringify({ requestId: input.requestId, campaignKey: input.campaignKey, apiKeyName, result }),
  } });
  await tx.auditLog.create({ data: { id: receiptId, organizationId, actorUserId: input.actorId, actorName: actor.user.name,
    action: "PANEL_DISTRIBUTION_RECEIPT", targetType: "Deal", targetId: deal.id,
    detail: JSON.stringify({ requestId: input.requestId, requestHash, result }),
  } });
  await tx.activity.create({ data: { organizationId, dealId: deal.id, contactId, userId: input.actorId, type: "SYSTEM",
    body: `Painel Nichos: redistribuiu o negócio e o contato para ${input.ownerId}; etapa ${deal.stageId} → ${input.stageId}; status ${deal.status} → OPEN. Auditoria: ${auditId}.`,
  } });
  return result;
}
