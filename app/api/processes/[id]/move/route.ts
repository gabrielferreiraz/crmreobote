import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProcessAccess } from "@/lib/processes/access";
import { runWithTenant } from "@/lib/tenant-context";
import { notifyProcessReachedFinalStage } from "@/lib/processes/notify";

export const dynamic = "force-dynamic";

/**
 * Move o processo de etapa — só administrativo (consultor nunca edita, só
 * observa). Toda movimentação grava quem/quando/de-onde-pra-onde em
 * ProcessStageHistory (auditoria, nunca editável depois) — é o "saber quando
 * foi passado de fase, por quem, que horário" pedido.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { stageId } = body as { stageId?: string };

  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  if (!stageId) return NextResponse.json({ error: "stageId é obrigatório" }, { status: 400 });

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.process.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const targetStage = await prisma.processStage.findFirst({
      where: { id: stageId, pipelineId: existing.pipelineId },
    });
    if (!targetStage) return NextResponse.json({ error: "Etapa inválida" }, { status: 400 });

    if (existing.stageId === stageId) {
      return NextResponse.json({ error: "Processo já está nesta etapa" }, { status: 400 });
    }

    const [process] = await prisma.$transaction([
      prisma.process.update({
        where: { id },
        data: { stageId, stageEnteredAt: new Date() },
        include: { contact: true, owner: { select: { id: true, name: true } }, stage: true },
      }),
      prisma.processStageHistory.create({
        data: {
          processId: id,
          organizationId: access.organizationId,
          fromStageId: existing.stageId,
          toStageId: stageId,
          changedById: access.userId,
        },
      }),
    ]);

    if (targetStage.isFinal) {
      notifyProcessReachedFinalStage(access.organizationId, {
        id: process.id,
        contactName: process.contact.name,
        stageName: targetStage.name,
      }).catch((err) => console.error("[processes] falha ao notificar etapa final", err));
    }

    return NextResponse.json(process);
  });
}
