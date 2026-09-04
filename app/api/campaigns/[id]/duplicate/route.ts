import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { parseAudienceFilter, audienceFilterIsEmpty, buildAudienceWhere } from "@/lib/campaigns/audience";
import type { Prisma } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

/**
 * Duplica uma campanha existente como rascunho — mesma configuração
 * (scripts, delay, janela, reenvio). Dois modos pra montar a lista de
 * destinatários (ver `mode` no body):
 *
 * - "same_filter" (padrão, comportamento de sempre): remonta a lista na
 *   hora a partir do mesmo público-alvo (cargo/tag/cidade), pra pegar
 *   contatos novos cadastrados desde a campanha original. Só funciona se a
 *   original tinha um filtro de público de verdade — campanhas
 *   PIPELINE_BULK/LEAD_CAPTURE (lista montada por seleção manual, não por
 *   filtro) não têm o que remontar aqui.
 * - "same_contacts": copia a lista de destinatários da campanha original
 *   tal como está (mesmos contatos, e — importante pra PIPELINE_BULK —
 *   mesmo dealId/instanceId por destinatário, preservando de qual
 *   consultor cada um deve sair). É o único modo que funciona pra
 *   campanhas sem filtro de público, e é o pedido explícito de "duplicar
 *   com os mesmos contatos" independente da origem.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const mode = body?.mode === "same_contacts" ? "same_contacts" : "same_filter";

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const original = await prisma.campaign.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!original) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

    let recipientRows: { contactId: string; dealId: string | null; instanceId: string | null }[];

    if (mode === "same_contacts") {
      const originalRecipients = await prisma.campaignRecipient.findMany({
        where: { campaignId: original.id },
        select: { contactId: true, dealId: true, instanceId: true },
      });
      if (originalRecipients.length === 0) {
        return NextResponse.json({ error: "Essa campanha não tem nenhum destinatário pra copiar" }, { status: 400 });
      }
      recipientRows = originalRecipients;
    } else {
      const audienceFilter = parseAudienceFilter(original.audienceFilter);
      if (audienceFilterIsEmpty(audienceFilter)) {
        return NextResponse.json(
          { error: "Essa campanha não tem um filtro de público pra remontar — duplique com \"Mesmos contatos\"" },
          { status: 400 },
        );
      }
      const contacts = await prisma.contact.findMany({
        where: buildAudienceWhere(access.organizationId, audienceFilter),
        select: { id: true },
      });
      if (contacts.length === 0) {
        return NextResponse.json({ error: "Nenhum contato encontrado com esse público" }, { status: 400 });
      }
      recipientRows = contacts.map((c) => ({ contactId: c.id, dealId: null, instanceId: null }));
    }

    const copy = await prisma.campaign.create({
      data: {
        organizationId: access.organizationId,
        name: `${original.name} (cópia)`,
        source: original.source,
        audienceFilter: original.audienceFilter as Prisma.InputJsonValue,
        instanceId: original.instanceId,
        messageTemplates: original.messageTemplates as Prisma.InputJsonValue,
        delayMinSec: original.delayMinSec,
        delayMaxSec: original.delayMaxSec,
        dailyCap: original.dailyCap,
        allowedWeekdays: original.allowedWeekdays,
        windowStartHour: original.windowStartHour,
        windowEndHour: original.windowEndHour,
        followUpEnabled: original.followUpEnabled,
        followUpDelayHours: original.followUpDelayHours,
        followUpTemplates: original.followUpTemplates === null ? undefined : (original.followUpTemplates as Prisma.InputJsonValue),
        // RMKT/expiração (LEAD_CAPTURE) — mesma configuração da original,
        // senão uma cópia de campanha LEAD_CAPTURE perderia as ondas.
        rmktWaves: original.rmktWaves === null ? undefined : (original.rmktWaves as Prisma.InputJsonValue),
        noReplyDays: original.noReplyDays,
        targetPipelineId: original.targetPipelineId,
        targetStageId: original.targetStageId,
        createdById: access.userId,
      },
    });

    await prisma.campaignRecipient.createMany({
      data: recipientRows.map((r) => ({
        campaignId: copy.id,
        contactId: r.contactId,
        dealId: r.dealId,
        instanceId: r.instanceId,
      })),
      skipDuplicates: true,
    });

    return NextResponse.json({ ...copy, recipientCount: recipientRows.length }, { status: 201 });
  });
}
