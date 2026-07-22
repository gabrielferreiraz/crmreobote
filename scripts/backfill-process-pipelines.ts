/**
 * Backfill do módulo de Processos (pós-venda) — roda uma vez pra organização
 * que já existia antes deste recurso: garante o pipeline padrão (com etapas)
 * e cria um Processo pra todo negócio já Ganho que ainda não tinha um.
 * Idempotente — seguro rodar de novo (createProcessForWonDeal nunca duplica,
 * getOrCreateDefaultProcessPipeline reaproveita o pipeline se já existir).
 *
 * Uso: npx tsx --env-file=.env scripts/backfill-process-pipelines.ts
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getOrCreateDefaultProcessPipeline, createProcessForWonDeal } from "@/lib/processes/create";

async function main() {
  const organizations = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`[backfill] ${organizations.length} organização(ões) encontrada(s)`);

  for (const org of organizations) {
    await runWithTenant(org.id, async () => {
      const pipeline = await getOrCreateDefaultProcessPipeline(org.id);
      console.log(`[backfill] ${org.name}: pipeline "${pipeline.name}" (${pipeline.stages.length} etapa(s))`);

      const wonDeals = await prisma.deal.findMany({
        where: { organizationId: org.id, status: "WON", process: null },
        select: { id: true, contactId: true, ownerId: true },
      });
      console.log(`[backfill] ${org.name}: ${wonDeals.length} negócio(s) ganho(s) sem processo`);

      for (const deal of wonDeals) {
        await createProcessForWonDeal(org.id, deal, deal.ownerId);
      }
    });
  }

  console.log("[backfill] concluído");
}

main()
  .catch((err) => {
    console.error("[backfill] falhou", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
