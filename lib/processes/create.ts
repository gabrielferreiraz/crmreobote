/**
 * Cria o Processo de pós-venda de um negócio ganho — chamado tanto pelo
 * fluxo normal (PUT /api/deals/[id], transição pra WON) quanto pelo script
 * de backfill (scripts/backfill-process-pipelines.ts, pra negócio já ganho
 * antes deste recurso existir). Idempotente: nunca cria um segundo processo
 * pro mesmo negócio (Process.dealId é @unique).
 */

import { prisma } from "@/lib/prisma";
import { DEFAULT_PROCESS_PIPELINE_NAME, DEFAULT_PROCESS_STAGES } from "@/lib/default-process-pipeline";

/** Acha o pipeline padrão da organização, ou cria um (com as etapas padrão) se ainda não existir — mesma ideia do pipeline de vendas no cadastro. */
export async function getOrCreateDefaultProcessPipeline(organizationId: string) {
  const existing = await prisma.processPipeline.findFirst({
    where: { organizationId, isDefault: true },
    include: { stages: { orderBy: { order: "asc" } } },
  });
  if (existing) return existing;

  return prisma.processPipeline.create({
    data: {
      organizationId,
      name: DEFAULT_PROCESS_PIPELINE_NAME,
      isDefault: true,
      order: 0,
      stages: {
        create: DEFAULT_PROCESS_STAGES.map((s) => ({
          name: s.name,
          order: s.order,
          color: s.color,
          isFinal: s.isFinal,
        })),
      },
    },
    include: { stages: { orderBy: { order: "asc" } } },
  });
}

export async function createProcessForWonDeal(
  organizationId: string,
  deal: { id: string; contactId: string; ownerId: string },
  changedById: string,
): Promise<void> {
  const existing = await prisma.process.findUnique({ where: { dealId: deal.id }, select: { id: true } });
  if (existing) return;

  const pipeline = await getOrCreateDefaultProcessPipeline(organizationId);
  if (pipeline.stages.length === 0) {
    console.warn(`[processes] organização ${organizationId} sem etapa de pós-venda configurada — negócio ${deal.id} não virou processo`);
    return;
  }
  const firstStage = pipeline.stages[0];

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
}
