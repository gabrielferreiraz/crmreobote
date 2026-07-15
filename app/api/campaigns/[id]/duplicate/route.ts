import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { parseAudienceFilter, audienceFilterIsEmpty, buildAudienceWhere } from "@/lib/campaigns/audience";
import type { Prisma } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

/**
 * Duplica uma campanha existente como rascunho — mesma configuração
 * (scripts, delay, janela, reenvio, público), mas com a lista de
 * destinatários remontada na hora a partir do mesmo público-alvo, pra pegar
 * contatos novos cadastrados desde a campanha original (mesma regra de
 * "snapshot na criação" de uma campanha nova).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const original = await prisma.campaign.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!original) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

    const audienceFilter = parseAudienceFilter(original.audienceFilter);
    const contacts = audienceFilterIsEmpty(audienceFilter)
      ? []
      : await prisma.contact.findMany({
          where: buildAudienceWhere(access.organizationId, audienceFilter),
          select: { id: true },
        });
    if (contacts.length === 0) {
      return NextResponse.json({ error: "Nenhum contato encontrado com esse público" }, { status: 400 });
    }

    const copy = await prisma.campaign.create({
      data: {
        organizationId: access.organizationId,
        name: `${original.name} (cópia)`,
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
        createdById: access.userId,
      },
    });

    await prisma.campaignRecipient.createMany({
      data: contacts.map((c) => ({ campaignId: copy.id, contactId: c.id })),
      skipDuplicates: true,
    });

    return NextResponse.json({ ...copy, recipientCount: contacts.length }, { status: 201 });
  });
}
