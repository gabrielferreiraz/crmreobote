import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { resolveCampaignInput, type CampaignInput } from "@/lib/campaigns/build";
import type { $Enums, Prisma } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

const VALID_STATUSES: $Enums.CampaignStatus[] = ["DRAFT", "RUNNING", "PAUSED", "DONE"];

/** Config completa (não o resumo de lib/campaigns/list.ts) — usada pelo modal de edição pra pré-preencher o formulário. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "ADMIN"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const campaign = await prisma.campaign.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!campaign) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    return NextResponse.json(campaign);
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const access = await requireRole(["OWNER", "ADMIN"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.campaign.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!existing) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

    const bodyKeys = Object.keys(body);
    const isStatusOnly = bodyKeys.length === 1 && bodyKeys[0] === "status";

    if (isStatusOnly) {
      const { status } = body as { status?: string };
      if (!status || !VALID_STATUSES.includes(status as $Enums.CampaignStatus)) {
        return NextResponse.json({ error: "Status inválido" }, { status: 400 });
      }
      const campaign = await prisma.campaign.update({ where: { id }, data: { status: status as $Enums.CampaignStatus } });
      return NextResponse.json(campaign);
    }

    // Edição completa (nome, público, scripts, agenda...) só é permitida
    // enquanto a campanha nunca começou a rodar — depois disso, duplicar é o
    // caminho pra mudar algo (ver /api/campaigns/[id]/duplicate).
    if (existing.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Só é possível editar campanhas em rascunho — duplique pra criar uma nova com outra configuração" },
        { status: 400 },
      );
    }

    const resolved = await resolveCampaignInput(access.organizationId, body as CampaignInput);
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 });
    const v = resolved.value;

    const campaign = await prisma.campaign.update({
      where: { id },
      data: {
        name: v.name,
        audienceFilter: v.audienceFilter as unknown as Prisma.InputJsonValue,
        instanceId: v.instanceId,
        messageTemplates: v.messageTemplates,
        delayMinSec: v.delayMinSec,
        delayMaxSec: v.delayMaxSec,
        dailyCap: v.dailyCap,
        allowedWeekdays: v.allowedWeekdays,
        windowStartHour: v.windowStartHour,
        windowEndHour: v.windowEndHour,
        followUpEnabled: v.followUpEnabled,
        followUpDelayHours: v.followUpDelayHours,
        followUpTemplates: v.followUpTemplates,
      },
    });

    // Rascunho nunca enviou nada ainda — seguro remontar a lista de
    // destinatários do zero a partir do público (re)configurado.
    await prisma.campaignRecipient.deleteMany({ where: { campaignId: id } });
    await prisma.campaignRecipient.createMany({
      data: v.contactIds.map((contactId) => ({ campaignId: id, contactId })),
      skipDuplicates: true,
    });

    return NextResponse.json({ ...campaign, recipientCount: v.contactIds.length });
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "ADMIN"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.campaign.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!existing) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

    await prisma.campaign.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
