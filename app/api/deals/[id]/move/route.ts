import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { stageId } = body as { stageId?: string };

  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!stageId) return NextResponse.json({ error: "stageId é obrigatório" }, { status: 400 });

  return runWithTenant(organizationId, async () => {
    const existing = await prisma.deal.findFirst({ where: { id, organizationId } });
    if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const stage = await prisma.pipelineStage.findFirst({
      where: { id: stageId, pipelineId: existing.pipelineId },
    });
    if (!stage) return NextResponse.json({ error: "Etapa inválida" }, { status: 400 });

    const deal = await prisma.deal.update({
      where: { id },
      data: { stageId, stageEnteredAt: new Date() },
      include: { contact: true, owner: true, stage: true },
    });

    return NextResponse.json(deal);
  });
}
