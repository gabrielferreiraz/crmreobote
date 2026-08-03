/**
 * Backfill de Reuniões/Visitas migradas do Agendor: import-tarefas.ts só
 * cria Task (MEETING/VISIT), nunca Activity — mas o relatório de
 * "Reuniões/visitas" (app/(dashboard)/relatorios/page.tsx,
 * meetingsAndVisitsByOwner) conta de Activity, não de Task. Activity é o
 * registro de "isso aconteceu"; Task é o lembrete/agendamento — no fluxo
 * normal do CRM os dois nascem juntos ao logar uma reunião (ver
 * submitActivity em app/(dashboard)/negocios/[id]/deal-detail.tsx), mas a
 * migração só produziu o lado Task. Sem este backfill, todo o histórico de
 * reuniões/visitas migradas fica invisível em Relatórios.
 *
 * Só cria Activity pra Task migrada (agendorTaskId preenchido) e já
 * CONCLUÍDA (completedAt preenchido) — reunião/visita que nunca aconteceu
 * de verdade não deveria contar. Create-only por (agendorTaskId, userId),
 * mesma chave de reconciliação do Task de origem — seguro pra rodar de novo.
 *
 * Uso: npx tsx --env-file=.env scripts/agendor/backfill-meeting-visit-activities.ts [--dry-run]
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ORGANIZATION_ID } from "@/scripts/agendor/users";
import { runConcurrent } from "@/scripts/agendor/concurrency";
import type { $Enums } from "@/app/generated/prisma/client";

const CONCURRENCY = 16;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(dryRun ? "🔎 MODO DRY-RUN — nada será gravado no banco.\n" : "⚠️  MODO REAL — gravando no banco.\n");

  await runWithTenant(ORGANIZATION_ID, async () => {
    const tasks = await prisma.task.findMany({
      where: {
        organizationId: ORGANIZATION_ID,
        agendorTaskId: { not: null },
        type: { in: ["MEETING", "VISIT"] },
        completedAt: { not: null },
      },
      select: {
        agendorTaskId: true,
        ownerId: true,
        dealId: true,
        contactId: true,
        type: true,
        title: true,
        description: true,
        completedAt: true,
      },
    });
    console.log(`Tarefas migradas de Reunião/Visita já concluídas: ${tasks.length}`);

    const existing = await prisma.activity.findMany({
      where: { organizationId: ORGANIZATION_ID, agendorTaskId: { not: null } },
      select: { agendorTaskId: true, userId: true },
    });
    const existingKeys = new Set(existing.map((a) => `${a.agendorTaskId}::${a.userId}`));

    let created = 0;
    let skippedAlreadyBackfilled = 0;

    // Banco remoto + RLS (várias idas por operação, ver concurrency.ts) —
    // 16 em voo ao mesmo tempo em vez de uma Activity de cada vez, mesmo
    // padrão de import-tarefas.ts pro mesmo volume de linhas.
    await runConcurrent(tasks, CONCURRENCY, async (task) => {
      const key = `${task.agendorTaskId}::${task.ownerId}`;
      if (existingKeys.has(key)) {
        skippedAlreadyBackfilled++;
        return;
      }

      if (dryRun) {
        created++;
        return;
      }

      try {
        await prisma.activity.create({
          data: {
            organizationId: ORGANIZATION_ID,
            dealId: task.dealId,
            contactId: task.contactId,
            userId: task.ownerId,
            type: task.type as $Enums.ActivityType,
            body: task.description ?? task.title,
            createdAt: task.completedAt!,
            agendorTaskId: task.agendorTaskId,
          },
        });
        created++;
      } catch (err) {
        console.error(
          `[backfill] falha ao criar Activity (agendorTaskId ${task.agendorTaskId}, responsável ${task.ownerId}):`,
          err instanceof Error ? err.message : err,
        );
      }
    });

    console.log(`\nCriadas: ${created}, já existiam (rodou antes): ${skippedAlreadyBackfilled}`);
    console.log(dryRun ? "(dry-run — nada foi gravado)" : "✅ Concluído.");
  });
}

main()
  .catch((err) => {
    console.error("\n❌ Falhou:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
