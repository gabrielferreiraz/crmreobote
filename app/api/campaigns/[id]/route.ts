import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import type { $Enums } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

const VALID_STATUSES: $Enums.CampaignStatus[] = ["DRAFT", "RUNNING", "PAUSED", "DONE"];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { status } = body as { status?: string };

  const access = await requireRole(["OWNER", "ADMIN"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!status || !VALID_STATUSES.includes(status as $Enums.CampaignStatus)) {
    return NextResponse.json({ error: "Status inválido" }, { status: 400 });
  }

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.campaign.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!existing) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

    const campaign = await prisma.campaign.update({
      where: { id },
      data: { status: status as $Enums.CampaignStatus },
    });

    return NextResponse.json(campaign);
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
