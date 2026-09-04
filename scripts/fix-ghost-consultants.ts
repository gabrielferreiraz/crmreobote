/**
 * Corrige o padrão "conta fantasma paralela": um consultor que JÁ tem User
 * real e ativo no CRM, mas cujo nome/username não estava em
 * ACTIVE_CONSULTANTS (scripts/agendor/users.ts) — então toda importação do
 * Agendor que mencionava esse nome criou/usou um User sintético inativo
 * (`{slug}@agendor-inativo.local`) em vez de resolver pro real. Mesmo caso
 * do Cláudio Ribas (03/09), agora achado em mais 4 pessoas na revisão do
 * --force-sync: mariana.ribeiro, wander.luis, joao.vitor, Lucas Cáceres —
 * já adicionados a ACTIVE_CONSULTANTS.
 *
 * Complicação a mais em relação ao caso Cláudio Ribas: Task e Activity têm
 * chave única (agendorTaskId, ownerId)/(agendorTaskId, userId) — pra essas
 * 4 pessoas, o MESMO agendorTaskId às vezes existe em DUAS linhas, uma sob
 * o fantasma (import mais recente, 03/09 — geralmente com o dado mais
 * completo: completedAt preenchido, nota de "como foi a visita/reunião")
 * e outra sob o usuário real (import mais antigo, geralmente mais pobre —
 * às vezes até completedAt=null quando a tarefa já foi concluída de
 * verdade). Pra cada colisão, mantém a linha "vencedora" (completedAt
 * preenchido > vazio; empate → título/corpo mais longo = mais informação)
 * e apaga a perdedora ANTES da reatribuição em massa — assim a
 * reatribuição não esbarra na constraint única (nem na
 * Task_owner_meeting_slot_unique, que é subconjunto do mesmo caso: toda
 * colisão de horário achada bate com uma colisão de agendorTaskId já
 * tratada aqui).
 *
 * Tudo dentro de UMA transação interativa por pessoa (prisma.$transaction
 * com callback) — testado neste mesmo lote que a forma em array
 * ($transaction([...])) NÃO é atômica de verdade neste setup (Prisma 7 +
 * @prisma/adapter-pg): uma falha no meio deixou UPDATEs anteriores já
 * commitados. A forma com callback abre uma transação real e mantém tudo
 * na mesma conexão até o fim.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/fix-ghost-consultants.ts [--dry-run]
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ORGANIZATION_ID } from "@/scripts/agendor/users";

const PAIRS: { ghostEmail: string; realEmail: string }[] = [
  { ghostEmail: "mariana.ribeiro@agendor-inativo.local", realEmail: "mariana.ribeiro@reoboteconsorcios.com.br" },
  { ghostEmail: "wander.luis@agendor-inativo.local", realEmail: "wander.luis@reoboteconsorcios.com.br" },
  { ghostEmail: "joao.vitor@agendor-inativo.local", realEmail: "joao.vitor@reoboteconsorcios.com.br" },
  { ghostEmail: "lucas.caceres@agendor-inativo.local", realEmail: "lucas.caceres@reoboteconsorcios.com.br" },
];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(dryRun ? "🔎 MODO DRY-RUN — nada será gravado.\n" : "⚠️  MODO REAL — gravando no banco.\n");

  await runWithTenant(ORGANIZATION_ID, async () => {
    for (const { ghostEmail, realEmail } of PAIRS) {
      const ghost = await prisma.user.findUnique({ where: { email: ghostEmail } });
      const real = await prisma.user.findUnique({ where: { email: realEmail } });

      if (!ghost) {
        console.log(`[${ghostEmail}] fantasma não existe — nada a fazer.`);
        continue;
      }
      if (!real) {
        console.error(`[${ghostEmail}] usuário real ${realEmail} NÃO encontrado — pulando por segurança.`);
        continue;
      }

      console.log(`\n=== ${ghostEmail} → ${realEmail} ===`);

      const run = async (tx: typeof prisma) => {
        // ── Colisões de Task (agendorTaskId igual dos dois lados) ──────────
        const ghostTasks = await tx.task.findMany({
          where: { ownerId: ghost.id, agendorTaskId: { not: null } },
          select: { id: true, agendorTaskId: true, title: true, completedAt: true },
        });
        const realTaskByAgendorId = new Map(
          (
            await tx.task.findMany({
              where: { ownerId: real.id, agendorTaskId: { in: ghostTasks.map((t) => t.agendorTaskId as string) } },
              select: { id: true, agendorTaskId: true, title: true, completedAt: true },
            })
          ).map((t) => [t.agendorTaskId as string, t]),
        );
        let taskLosersDeleted = 0;
        for (const g of ghostTasks) {
          const r = realTaskByAgendorId.get(g.agendorTaskId as string);
          if (!r) continue; // sem colisão, segue pra reatribuição em massa depois
          // Critério: completedAt preenchido vence vazio; empate → título mais longo (mais informação) vence.
          const gScore = (g.completedAt ? 2 : 0) + Math.min(g.title.length / 1000, 1);
          const rScore = (r.completedAt ? 2 : 0) + Math.min(r.title.length / 1000, 1);
          const loserId = gScore >= rScore ? r.id : g.id;
          console.log(`  [task] agendorTaskId=${g.agendorTaskId}: mantém ${gScore >= rScore ? "fantasma" : "real"}, apaga ${loserId}`);
          if (!dryRun) await tx.task.delete({ where: { id: loserId } });
          taskLosersDeleted++;
        }

        // ── Colisões de Activity (agendorTaskId igual dos dois lados) ──────
        const ghostActs = await tx.activity.findMany({
          where: { userId: ghost.id, agendorTaskId: { not: null } },
          select: { id: true, agendorTaskId: true, body: true },
        });
        const realActByAgendorId = new Map(
          (
            await tx.activity.findMany({
              where: { userId: real.id, agendorTaskId: { in: ghostActs.map((a) => a.agendorTaskId as string) } },
              select: { id: true, agendorTaskId: true, body: true },
            })
          ).map((a) => [a.agendorTaskId as string, a]),
        );
        let actLosersDeleted = 0;
        for (const g of ghostActs) {
          const r = realActByAgendorId.get(g.agendorTaskId as string);
          if (!r) continue;
          const gLen = (g.body ?? "").length;
          const rLen = (r.body ?? "").length;
          const loserId = gLen >= rLen ? r.id : g.id; // corpo mais longo = mais informação; empate mantém o fantasma (indiferente, mesmo conteúdo)
          console.log(`  [activity] agendorTaskId=${g.agendorTaskId}: mantém ${gLen >= rLen ? "fantasma" : "real"}, apaga ${loserId}`);
          if (!dryRun) await tx.activity.delete({ where: { id: loserId } });
          actLosersDeleted++;
        }

        // ── Reatribuição em massa do que sobrou ─────────────────────────────
        const [deals, tasks, contactsResp, contactsQualified, activities] = await Promise.all([
          tx.deal.count({ where: { ownerId: ghost.id } }),
          tx.task.count({ where: { ownerId: ghost.id } }),
          tx.contact.count({ where: { responsavelId: ghost.id } }),
          tx.contact.count({ where: { leadQualificationBy: ghost.id } }),
          tx.activity.count({ where: { userId: ghost.id } }),
        ]);
        console.log(
          `  reatribuir: deals=${deals} tasks=${tasks} contacts(responsavel)=${contactsResp} contacts(qualifiedBy)=${contactsQualified} activities=${activities} (colisões resolvidas: ${taskLosersDeleted} tasks, ${actLosersDeleted} activities)`,
        );

        if (dryRun) return;

        await tx.deal.updateMany({ where: { ownerId: ghost.id }, data: { ownerId: real.id } });
        await tx.task.updateMany({ where: { ownerId: ghost.id }, data: { ownerId: real.id } });
        await tx.contact.updateMany({ where: { responsavelId: ghost.id }, data: { responsavelId: real.id } });
        await tx.contact.updateMany({ where: { leadQualificationBy: ghost.id }, data: { leadQualificationBy: real.id } });
        await tx.activity.updateMany({ where: { userId: ghost.id }, data: { userId: real.id } });

        await tx.user.delete({ where: { id: ghost.id } });
        console.log(`  [${ghostEmail}] migrado e apagado.`);
      };

      if (dryRun) {
        // Dry-run não precisa de transação de verdade (não escreve nada) —
        // roda com o client normal mesmo, só leitura.
        await run(prisma);
      } else {
        await prisma.$transaction(async (tx) => run(tx as unknown as typeof prisma), { maxWait: 10_000, timeout: 60_000 });
      }
    }
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
