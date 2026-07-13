import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { findMissingRequiredFields, labelForRequiredField } from "@/lib/deal-required-fields";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { stageId, value } = body as { stageId?: string; value?: number | null };

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

    // Cada etapa define quais campos exige (configurado pelo admin em
    // Configurações → Pipeline) — etapas de nutrição/prospecção como
    // Remarketing normalmente não exigem nada, já que o lead ainda está frio.
    // Aceita o valor já vir junto no mesmo request (preencher e mover numa
    // ação só); os demais campos precisam já estar preenchidos no negócio.
    const missing = findMissingRequiredFields(stage.requiredFields, {
      value: value !== undefined ? value : existing.value,
      creditType: existing.creditType,
      expectedCloseAt: existing.expectedCloseAt,
    });
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Preencha antes de avançar: ${missing.map(labelForRequiredField).join(", ")}` },
        { status: 400 },
      );
    }

    const deal = await prisma.deal.update({
      where: { id },
      data: {
        stageId,
        stageEnteredAt: new Date(),
        ...(value !== undefined ? { value } : {}),
      },
      include: { contact: true, owner: true, stage: true },
    });

    return NextResponse.json(deal);
  });
}
