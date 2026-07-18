import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { getDealScope, scopeWhere } from "@/lib/team-scope";
import { runWithTenant } from "@/lib/tenant-context";
import { findMissingRequiredFields, labelForRequiredField } from "@/lib/deal-required-fields";
import { formatCurrency } from "@/lib/format";
import { recordUserChange } from "@/lib/user-activity";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { stageId, value, pipelineId } = body as { stageId?: string; value?: number | null; pipelineId?: string };

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { organizationId, userId } = access;
  if (!stageId) return NextResponse.json({ error: "stageId é obrigatório" }, { status: 400 });

  return runWithTenant(organizationId, async () => {
    const scope = await getDealScope(organizationId, userId, access.role);
    const existing = await prisma.deal.findFirst({ where: { id, organizationId, ...scopeWhere(scope) } });
    if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    // pipelineId opcional — sem ele, assume que a etapa é da mesma pipeline
    // de sempre (drag-and-drop no Kanban nunca muda de funil). Quando vem
    // (troca de funil em massa, ver Negócios → Lista), a etapa precisa
    // pertencer a essa pipeline nova, não mais à atual.
    const targetPipelineId = pipelineId ?? existing.pipelineId;
    if (pipelineId) {
      const pipeline = await prisma.pipeline.findFirst({ where: { id: pipelineId, organizationId } });
      if (!pipeline) return NextResponse.json({ error: "Pipeline inválida" }, { status: 400 });
    }

    const stage = await prisma.pipelineStage.findFirst({
      where: { id: stageId, pipelineId: targetPipelineId },
    });
    if (!stage) return NextResponse.json({ error: "Etapa inválida para a pipeline informada" }, { status: 400 });

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
        pipelineId: targetPipelineId,
        stageId,
        stageEnteredAt: new Date(),
        ...(value !== undefined ? { value } : {}),
      },
      include: { contact: true, owner: true, stage: true },
    });

    if (existing.stageId !== stageId) {
      const oldStage = await prisma.pipelineStage.findUnique({
        where: { id: existing.stageId },
        select: { name: true },
      });
      const valueSuffix = deal.value != null ? ` · ${formatCurrency(Number(deal.value))}` : "";
      const pipelineChanged = existing.pipelineId !== targetPipelineId;
      let moveDescription = `moveu o negócio de ${oldStage?.name ?? "—"} para ${stage.name}${valueSuffix}`;
      if (pipelineChanged) {
        const [oldPipeline, newPipeline] = await Promise.all([
          prisma.pipeline.findUnique({ where: { id: existing.pipelineId }, select: { name: true } }),
          prisma.pipeline.findUnique({ where: { id: targetPipelineId }, select: { name: true } }),
        ]);
        moveDescription = `moveu o negócio do funil ${oldPipeline?.name ?? "—"} (${oldStage?.name ?? "—"}) para ${newPipeline?.name ?? "—"} (${stage.name})${valueSuffix}`;
      }
      await prisma.activity.create({
        data: {
          organizationId,
          dealId: id,
          userId,
          type: "SYSTEM",
          body: moveDescription,
        },
      });
    }

    recordUserChange(organizationId, userId).catch((err) =>
      console.error("[user-activity] falha ao registrar alteração", err),
    );

    return NextResponse.json(deal);
  });
}
