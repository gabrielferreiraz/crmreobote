/**
 * Orquestrador da migração completa do Agendor → CRM próprio. Roda as 3
 * fases em ordem (Pessoas → Negócios → Tarefas), sempre create-only por
 * agendorContactId/agendorDealId/(agendorTaskId,ownerId) — seguro pra
 * rodar de novo mais pra frente sem duplicar (novo lote de consultor
 * migrando, Agendor continuando em paralelo pra quem ainda não migrou).
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/import-agendor.ts \
 *     --pessoas=<path> --negocios=<path> \
 *     --tarefas-pendentes=<path> --tarefas-finalizadas=<path> \
 *     [--dry-run]
 *
 * --dry-run roda toda a resolução/validação e imprime as contagens que
 * SERIAM criadas, sem gravar nada no banco — rode isso primeiro.
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ORGANIZATION_ID, ensureActiveConsultants } from "@/scripts/agendor/users";
import { ensurePipelines } from "@/scripts/agendor/pipelines";
import { buildCanonicalPersonMap } from "@/scripts/agendor/phone-dedup";
import { importPessoas } from "@/scripts/agendor/import-pessoas";
import { importNegocios, scanWonDealPersonIds } from "@/scripts/agendor/import-negocios";
import { importTarefas } from "@/scripts/agendor/import-tarefas";
import { withPhaseRetry } from "@/scripts/agendor/retry";

function parseArgs(): {
  pessoas: string;
  negocios: string;
  tarefasPendentes: string;
  tarefasFinalizadas: string;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const found = args.find((a) => a.startsWith(`--${flag}=`));
    return found ? found.slice(flag.length + 3) : undefined;
  };
  const pessoas = get("pessoas");
  const negocios = get("negocios");
  const tarefasPendentes = get("tarefas-pendentes");
  const tarefasFinalizadas = get("tarefas-finalizadas");
  const dryRun = args.includes("--dry-run");

  if (!pessoas || !negocios || !tarefasPendentes || !tarefasFinalizadas) {
    console.error(
      "Uso: npx tsx --env-file=.env scripts/import-agendor.ts --pessoas=<path> --negocios=<path> --tarefas-pendentes=<path> --tarefas-finalizadas=<path> [--dry-run]",
    );
    process.exit(1);
  }
  return { pessoas, negocios, tarefasPendentes, tarefasFinalizadas, dryRun };
}

async function main() {
  const { pessoas, negocios, tarefasPendentes, tarefasFinalizadas, dryRun } = parseArgs();
  console.log(dryRun ? "🔎 MODO DRY-RUN — nada será gravado no banco.\n" : "⚠️  MODO REAL — gravando no banco.\n");

  await runWithTenant(ORGANIZATION_ID, async () => {
    console.log("== Usuários ==");
    await ensureActiveConsultants(dryRun);

    console.log("\n== Pipelines ==");
    await ensurePipelines(dryRun);

    console.log("\n== Pré-passo: negócios Ganho por pessoa ==");
    const wonDealPersonIds = await scanWonDealPersonIds(negocios);

    console.log("\n== Dedup de telefone (Pessoas) ==");
    const canonicalMap = await buildCanonicalPersonMap(pessoas);

    console.log("\n== Importando Pessoas ==");
    const pessoasResult = await withPhaseRetry("Pessoas", () => importPessoas(pessoas, canonicalMap, wonDealPersonIds, dryRun));
    console.log("Resultado Pessoas:", pessoasResult);

    console.log("\n== Importando Negócios ==");
    const negociosResult = await withPhaseRetry("Negócios", () => importNegocios(negocios, canonicalMap, dryRun));
    console.log("Resultado Negócios:", negociosResult);

    console.log("\n== Importando Tarefas (pendentes) ==");
    const tarefasPendentesResult = await withPhaseRetry("Tarefas pendentes", () => importTarefas(tarefasPendentes, canonicalMap, dryRun));
    console.log("Resultado Tarefas pendentes:", tarefasPendentesResult);

    console.log("\n== Importando Tarefas (finalizadas) ==");
    const tarefasFinalizadasResult = await withPhaseRetry("Tarefas finalizadas", () => importTarefas(tarefasFinalizadas, canonicalMap, dryRun));
    console.log("Resultado Tarefas finalizadas:", tarefasFinalizadasResult);

    console.log("\n✅ Concluído.", dryRun ? "(dry-run — nada foi gravado)" : "");
  });
}

main()
  .catch((err) => {
    console.error("\n❌ Falhou:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
