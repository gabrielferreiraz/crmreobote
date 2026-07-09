import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { getCurrentOrganizationId, getCurrentUserId } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  console.log("[DEBUG move]", {
    organizationIdFromRequireSession: organizationId,
    contextOrgId: getCurrentOrganizationId(),
    contextUserId: getCurrentUserId(),
    dealId: id,
  });

  const existing = await prisma.deal.findFirst({ where: { id, organizationId } });
  console.log("[DEBUG move] findFirst result:", existing ? "FOUND" : "NULL");
  if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

  const { stageId } = body as { stageId?: string };
  if (!stageId) return NextResponse.json({ error: "stageId é obrigatório" }, { status: 400 });

  return runWithTenant(organizationId, async () => {
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
