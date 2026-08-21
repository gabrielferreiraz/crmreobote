import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/require-api-key";
import { runWithTenant } from "@/lib/tenant-context";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { apiSuccess, apiError } from "@/lib/api/v1-response";
import { upsertContactFromIntegration } from "@/lib/api/upsert-contact";
import { pickOwnerId } from "@/lib/auto-assign";
import { buildDealName } from "@/lib/deal-name";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { dealInputSchema, firstZodMessage } from "@/lib/api/v1-schemas";

export const dynamic = "force-dynamic";

/**
 * Cria um negócio já podendo criar/atualizar o contato na mesma chamada
 * (envie `contact: {...}` no formato de /api/v1/contacts, ou `contactId` se
 * o contato já existe). `pipelineId`/`stageId` são opcionais — sem eles,
 * usa a pipeline padrão da organização e a primeira etapa dela, pra não
 * exigir que o integrador externo conheça IDs internos de funil.
 */
export async function POST(req: Request) {
  const access = await requireApiKey(req);
  if (!access.ok) return apiError("Chave de API inválida ou revogada", 401);

  const rateLimited = rateLimitOrResponse(`apikey:${access.apiKeyId}:deals`, 30, 60_000);
  if (rateLimited) return rateLimited;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return apiError("Corpo da requisição precisa ser um objeto JSON", 400);
  }

  const parsedBody = dealInputSchema.safeParse(body);
  if (!parsedBody.success) return apiError(firstZodMessage(parsedBody.error), 400);

  const {
    contactId: givenContactId,
    contact: contactInput,
    pipelineId: givenPipelineId,
    stageId: givenStageId,
    ownerId: givenOwnerId,
    name,
    value,
    grossValue,
    creditType,
    description,
    source,
  } = parsedBody.data;

  return runWithTenant(access.organizationId, async () => {
    const warnings: string[] = [];
    let contact: { id: string; name: string; source: string | null };

    if (contactInput) {
      const result = await upsertContactFromIntegration(access.organizationId, {
        ...contactInput,
        source: contactInput.source ?? source,
      });
      if (!result.ok) return apiError(result.error, 400);
      contact = result.contact;
      warnings.push(...result.warnings);
    } else {
      const found = await prisma.contact.findFirst({
        where: { id: givenContactId, organizationId: access.organizationId },
        select: { id: true, name: true, source: true },
      });
      if (!found) return apiError("contactId inválido", 400);
      contact = found;
    }

    let pipelineId = givenPipelineId;
    let stageId = givenStageId;

    // pipelineId e stageId só fazem sentido juntos (a etapa pertence a uma
    // pipeline específica) — antes, mandar só um dos dois fazia o outro ser
    // ignorado em silêncio e a chamada cair na pipeline padrão, sem aviso
    // nenhum. Agora avisa e usa o padrão, igual ao tratamento de ownerId.
    if (pipelineId && !stageId) {
      warnings.push(`pipelineId "${pipelineId}" informado sem stageId — ignorado, usando a pipeline padrão da organização.`);
      pipelineId = undefined;
    } else if (stageId && !pipelineId) {
      warnings.push(`stageId "${stageId}" informado sem pipelineId — ignorado, usando a pipeline padrão da organização.`);
      stageId = undefined;
    }

    if (!pipelineId || !stageId) {
      const defaultPipeline = await prisma.pipeline.findFirst({
        where: { organizationId: access.organizationId },
        orderBy: [{ isDefault: "desc" }, { order: "asc" }],
        include: { stages: { orderBy: { order: "asc" }, take: 1 } },
      });
      if (!defaultPipeline || defaultPipeline.stages.length === 0) {
        return apiError("Nenhuma pipeline com etapas configurada — envie pipelineId e stageId", 400);
      }
      pipelineId = pipelineId ?? defaultPipeline.id;
      stageId = stageId ?? defaultPipeline.stages[0].id;
    } else {
      // Confere que a etapa pertence de fato à pipeline informada (não só à
      // organização) — sem isso dava pra criar um negócio com pipelineId e
      // stageId de pipelines diferentes, uma combinação inconsistente que
      // nunca deveria existir.
      const stage = await prisma.pipelineStage.findFirst({
        where: { id: stageId, pipelineId, pipeline: { organizationId: access.organizationId } },
      });
      if (!stage) return apiError("stageId inválido para a pipelineId informada", 400);
    }

    let ownerId = givenOwnerId;
    if (ownerId) {
      const membership = await prisma.organizationUser.findUnique({
        where: { organizationId_userId: { organizationId: access.organizationId, userId: ownerId } },
      });
      // Um ownerId errado/inativo não pode derrubar o negócio inteiro — cai
      // pra atribuição automática (mesmo fallback de quando ownerId não vem)
      // e avisa no lugar de rejeitar a chamada.
      if (!membership) {
        warnings.push(`ownerId "${ownerId}" não corresponde a nenhum usuário desta organização — atribuído automaticamente.`);
        ownerId = undefined;
      } else if (!membership.active) {
        warnings.push(`ownerId "${ownerId}" corresponde a um usuário inativo desta organização — atribuído automaticamente.`);
        ownerId = undefined;
      }
    }
    if (!ownerId) {
      const anyMember = await prisma.organizationUser.findFirst({
        where: { organizationId: access.organizationId, active: true },
        orderBy: { createdAt: "asc" },
        select: { userId: true },
      });
      if (!anyMember) return apiError("Nenhum usuário ativo nesta organização pra atribuir o negócio", 400);
      ownerId = await pickOwnerId(access.organizationId, anyMember.userId);
    }

    const deal = await prisma.deal.create({
      data: {
        organizationId: access.organizationId,
        pipelineId,
        stageId,
        contactId: contact.id,
        ownerId,
        name: sanitizeCell(name?.trim() || buildDealName(contact.name, contact.source)),
        value,
        grossValue,
        creditType: sanitizeCell(creditType),
        description: sanitizeCell(description),
      },
      include: { contact: true, owner: true, stage: true },
    });

    return apiSuccess(
      {
        id: deal.id,
        name: deal.name,
        status: deal.status,
        value: deal.value != null ? Number(deal.value) : null,
        grossValue: deal.grossValue != null ? Number(deal.grossValue) : null,
        creditType: deal.creditType,
        description: deal.description,
        pipelineId: deal.pipelineId,
        contact: { id: deal.contact.id, name: deal.contact.name, phone: deal.contact.phone, whatsapp: deal.contact.whatsapp },
        owner: { id: deal.owner.id, name: deal.owner.name },
        stage: { id: deal.stage.id, name: deal.stage.name },
        createdAt: deal.createdAt,
        warnings,
      },
      201,
    );
  });
}
