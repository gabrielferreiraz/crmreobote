/**
 * Só leitura — mostra os valores distintos de Deal.lostReason (texto livre
 * que a migração do Agendor preencheu, ver scripts/agendor/import-negocios.ts)
 * entre os negócios perdidos que ainda não têm lossReasonId estruturado.
 * Usado pra decidir o formato certo antes de escrever o backfill de verdade
 * (scripts/backfill-legacy-loss-reasons.ts).
 *
 * Uso: npx tsx --env-file=.env scripts/inspect-legacy-loss-reasons.ts
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

const ORG_ID = "cmr9i96330001ekvpb3b4o4nn"; // Reobote Consorcios

async function main() {
  await runWithTenant(ORG_ID, async () => {
    const deals = await prisma.deal.findMany({
      where: { organizationId: ORG_ID, status: "LOST", lossReasonId: null },
      select: { lostReason: true },
    });

    console.log(`Total de negócios perdidos sem motivo estruturado: ${deals.length}`);

    const counts = new Map<string, number>();
    let nullOrEmpty = 0;
    for (const d of deals) {
      const v = d.lostReason?.trim();
      if (!v) {
        nullOrEmpty += 1;
        continue;
      }
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }

    console.log(`  sem lostReason nenhum (nem texto livre): ${nullOrEmpty}`);
    console.log(`  com lostReason: ${deals.length - nullOrEmpty}, em ${counts.size} valor(es) distinto(s)\n`);

    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    for (const [value, count] of sorted) {
      console.log(`  ${String(count).padStart(4)}x  ${JSON.stringify(value)}`);
    }
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
