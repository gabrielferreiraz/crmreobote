/**
 * Corrige Contact.whatsapp/whatsappNormalized que foram salvos sem o 9º
 * dígito do celular (10 dígitos em vez de 11, DDD brasileiro válido) — ver
 * ensureBrazilianMobileNinthDigit em lib/phone-normalize.ts pro porquê isso
 * é seguro especificamente pro campo WhatsApp (nunca em `phone` genérico,
 * que pode ser fixo de verdade).
 *
 * Roda em modo RELATÓRIO por padrão (nenhuma escrita) — passe --apply pra
 * gravar de verdade. Detecta colisão (dois contatos que, corrigidos,
 * empatariam no mesmo whatsappNormalized) ANTES de escrever qualquer coisa
 * e pula esses casos, reportados à parte pra revisão manual — nunca
 * sobrescreve um contato por cima do outro silenciosamente.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/backfill-whatsapp-ninth-digit.ts            (relatório)
 *   npx tsx --env-file=.env scripts/backfill-whatsapp-ninth-digit.ts --apply    (grava)
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ensureBrazilianMobileNinthDigit, formatPhoneMask } from "@/lib/phone-normalize";

const ORG_ID = "cmr9i96330001ekvpb3b4o4nn"; // Reobote Consorcios
const APPLY = process.argv.includes("--apply");

async function main() {
  await runWithTenant(ORG_ID, async () => {
    const contacts = await prisma.contact.findMany({
      where: { organizationId: ORG_ID, whatsappNormalized: { not: null } },
      select: { id: true, name: true, whatsapp: true, whatsappNormalized: true },
    });

    // Índice de todo whatsappNormalized já existente na organização — pra
    // detectar colisão ANTES de escrever (um contato corrigido não pode
    // passar a "roubar" o número de outro que já tinha o 9 certo).
    const existingNormalized = new Set(contacts.map((c) => c.whatsappNormalized).filter((v): v is string => !!v));

    const toFix: { id: string; name: string; from: string; to: string }[] = [];
    const collisions: { id: string; name: string; from: string; to: string; collidesWithExisting: boolean }[] = [];

    for (const c of contacts) {
      const current = c.whatsappNormalized!;
      const corrected = ensureBrazilianMobileNinthDigit(current);
      if (corrected === current) continue; // não precisava de correção

      if (existingNormalized.has(corrected!)) {
        collisions.push({ id: c.id, name: c.name, from: current, to: corrected!, collidesWithExisting: true });
        continue;
      }
      toFix.push({ id: c.id, name: c.name, from: current, to: corrected! });
    }

    // Colisão ENTRE dois contatos que ambos precisavam de correção pro
    // MESMO valor final (raro, mas possível) — segunda passada, já que
    // `existingNormalized` só cobre quem já estava correto de antes.
    const targetCounts = new Map<string, number>();
    for (const f of toFix) targetCounts.set(f.to, (targetCounts.get(f.to) ?? 0) + 1);
    const mutualCollisionTargets = new Set([...targetCounts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
    const safe = toFix.filter((f) => !mutualCollisionTargets.has(f.to));
    const mutual = toFix.filter((f) => mutualCollisionTargets.has(f.to));

    console.log(`Total de contatos com whatsappNormalized: ${contacts.length}`);
    console.log(`Precisam de correção (9º dígito faltante): ${toFix.length}`);
    console.log(`  → seguros pra corrigir: ${safe.length}`);
    console.log(`  → colidem com contato JÁ correto (pulados): ${collisions.length}`);
    console.log(`  → colidem entre si, dois corrigiriam pro mesmo número (pulados): ${mutual.length}`);

    if (collisions.length > 0) {
      console.log("\nColisões com contato já correto (revisar manualmente):");
      for (const c of collisions.slice(0, 20)) {
        console.log(`  "${c.name}" (${c.id}): ${c.from} → ${c.to} já existe em outro contato`);
      }
      if (collisions.length > 20) console.log(`  ... e mais ${collisions.length - 20}`);
    }
    if (mutual.length > 0) {
      console.log("\nColisões mútuas (revisar manualmente):");
      for (const c of mutual.slice(0, 20)) {
        console.log(`  "${c.name}" (${c.id}): ${c.from} → ${c.to}`);
      }
      if (mutual.length > 20) console.log(`  ... e mais ${mutual.length - 20}`);
    }

    if (!APPLY) {
      console.log(`\n[relatório apenas — nada foi gravado; rode com --apply pra corrigir os ${safe.length} seguros]`);
      return;
    }

    console.log(`\nGravando ${safe.length} correções...`);
    let done = 0;
    for (const f of safe) {
      await prisma.contact.update({
        where: { id: f.id },
        data: { whatsapp: formatPhoneMask(f.to), whatsappNormalized: f.to },
      });
      done++;
      if (done % 500 === 0) console.log(`  ${done}/${safe.length}...`);
    }
    console.log(`Concluído: ${done} contatos corrigidos.`);
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
