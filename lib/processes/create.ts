/**
 * Cria o Processo de pós-venda de um negócio ganho — chamado a partir da
 * ação manual "Adicionar ao processo" (ver app/api/processes/route.ts POST
 * e app/(dashboard)/processos/add-to-process-dialog.tsx). Ganhar o negócio
 * sozinho NÃO cria mais um processo automaticamente: o setor de
 * contemplações decide, negócio a negócio, quando (e em qual
 * Categoria/Subcategoria) ele entra no acompanhamento de pós-venda — ver
 * discussão que motivou essa mudança. Idempotente: nunca cria um segundo
 * processo pro mesmo negócio (Process.dealId é @unique).
 */

import { prisma } from "@/lib/prisma";

export async function createProcessForDeal(
  organizationId: string,
  deal: { id: string; contactId: string; ownerId: string },
  pipelineId: string,
  changedById: string,
): Promise<{ ok: true; processId: string } | { ok: false; error: string }> {
  const existing = await prisma.process.findUnique({ where: { dealId: deal.id }, select: { id: true } });
  if (existing) return { ok: false, error: "Este negócio já tem um processo" };

  const pipeline = await prisma.processPipeline.findFirst({
    where: { id: pipelineId, organizationId },
    include: { stages: { orderBy: { order: "asc" }, take: 1 } },
  });
  if (!pipeline) return { ok: false, error: "Subcategoria inválida" };
  const firstStage = pipeline.stages[0];
  if (!firstStage) return { ok: false, error: "Esta subcategoria ainda não tem nenhuma etapa configurada" };

  const process = await prisma.process.create({
    data: {
      organizationId,
      pipelineId: pipeline.id,
      stageId: firstStage.id,
      dealId: deal.id,
      contactId: deal.contactId,
      ownerId: deal.ownerId,
    },
  });

  await prisma.processStageHistory.create({
    data: {
      processId: process.id,
      organizationId,
      fromStageId: null,
      toStageId: firstStage.id,
      changedById,
    },
  });

  return { ok: true, processId: process.id };
}
