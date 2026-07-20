/**
 * Processa UM lead de formulário nativo (Lead Ads) a partir do leadgen_id
 * que chega no webhook (app/api/meta-ads/webhook) — busca os dados
 * completos, cria/atualiza o Contact já com a atribuição (qual anúncio/
 * campanha/formulário) e cria um Deal na pipeline padrão pra já cair
 * acionável, não só um cadastro cru. Idempotente por metaLeadgenId: a Meta
 * reenvia o mesmo webhook às vezes.
 */

import { prisma } from "@/lib/prisma";
import { fetchLeadDetails, type LeadDetails } from "@/lib/meta-ads";
import { upsertContactFromIntegration } from "@/lib/api/upsert-contact";
import { pickOwnerId } from "@/lib/auto-assign";
import { buildDealName } from "@/lib/deal-name";

function leadDisplayName(lead: LeadDetails): string {
  if (lead.fields.name) return lead.fields.name;
  const combined = [lead.fields.firstName, lead.fields.lastName].filter(Boolean).join(" ");
  return combined || "Lead do Facebook";
}

/** Cria o negócio na pipeline padrão (primeira etapa) — mesma regra de fallback usada em /api/v1/deals quando o integrador não informa pipeline/etapa. */
async function createDealForLead(
  organizationId: string,
  contact: { id: string; name: string; source: string | null },
  lead: LeadDetails,
): Promise<void> {
  const defaultPipeline = await prisma.pipeline.findFirst({
    where: { organizationId },
    orderBy: [{ isDefault: "desc" }, { order: "asc" }],
    include: { stages: { orderBy: { order: "asc" }, take: 1 } },
  });
  if (!defaultPipeline || defaultPipeline.stages.length === 0) {
    console.warn(`[meta-ads] organização ${organizationId} sem pipeline configurada — lead virou só Contact, sem Deal`);
    return;
  }

  const anyMember = await prisma.organizationUser.findFirst({
    where: { organizationId, active: true },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });
  if (!anyMember) {
    console.warn(`[meta-ads] organização ${organizationId} sem usuário ativo — lead virou só Contact, sem Deal`);
    return;
  }
  const ownerId = await pickOwnerId(organizationId, anyMember.userId);

  await prisma.deal.create({
    data: {
      organizationId,
      pipelineId: defaultPipeline.id,
      stageId: defaultPipeline.stages[0].id,
      contactId: contact.id,
      ownerId,
      name: buildDealName(contact.name, lead.campaignName ?? contact.source ?? "Facebook Ads"),
    },
  });
}

export async function processLeadgenEvent(organizationId: string, leadgenId: string, pageAccessToken: string): Promise<void> {
  const existing = await prisma.contact.findUnique({ where: { metaLeadgenId: leadgenId }, select: { id: true } });
  if (existing) {
    console.log(`[meta-ads] leadgenId ${leadgenId} já processado — ignorando (retry do webhook)`);
    return;
  }

  const lead = await fetchLeadDetails(leadgenId, pageAccessToken);
  const name = leadDisplayName(lead);
  const phone = lead.fields.phone;

  const upsertResult = await upsertContactFromIntegration(organizationId, {
    name,
    email: lead.fields.email,
    phone,
    // Lead Ads não distingue "celular" de "whatsapp" — o mesmo número
    // preenchido no formulário serve pros dois, mesma convenção que
    // POST /api/v1/contacts já usa quando só um dos dois vem preenchido.
    whatsapp: phone,
    source: lead.campaignName || "Facebook Ads",
    jobTitle: lead.fields.jobTitle,
    company: lead.fields.company,
    city: lead.fields.city,
  });

  if (!upsertResult.ok) {
    console.error(`[meta-ads] falha ao criar/atualizar contato do lead ${leadgenId}: ${upsertResult.error}`);
    return;
  }

  const contact = await prisma.contact.update({
    where: { id: upsertResult.contact.id },
    data: {
      metaLeadgenId: leadgenId,
      metaAdId: lead.adId,
      metaAdSetId: lead.adSetId,
      metaCampaignId: lead.campaignId,
      metaCampaignName: lead.campaignName,
      metaFormId: lead.formId,
    },
    select: { id: true, name: true, source: true },
  });

  console.log(`[meta-ads] lead ${leadgenId} processado — contato ${contact.id} (${upsertResult.outcome}), campanha="${lead.campaignName ?? "—"}"`);

  const existingOpenDeal = await prisma.deal.findFirst({ where: { organizationId, contactId: contact.id, status: "OPEN" } });
  if (!existingOpenDeal) {
    await createDealForLead(organizationId, contact, lead);
  }
}
