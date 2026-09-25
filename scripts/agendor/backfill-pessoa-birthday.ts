/**
 * Backfill de aniversário nos Contact já importados do Agendor ANTES da
 * leitura de "Aniversário"/"Ano de nascimento" existir em import-pessoas.ts
 * (create-only — rodar a importação de novo não preenche quem já existe).
 *
 * Grava em Contact.birthDate ("Data de nascimento") — o campo personalizado
 * "Aniversário" que este script preenchia foi unificado nele em 09/2026 (ver
 * scripts/migrate-birthdays-to-native.ts) e NÃO deve ser recriado.
 *
 * Mesmo espírito conservador do backfill-pessoa-address.ts: só preenche
 * quem AINDA NÃO tem data de nascimento (nunca sobrescreve) e só data que
 * passa na validação do formulário (dia existente, 1900..hoje).
 *
 * Uso: npx tsx --env-file=.env scripts/agendor/backfill-pessoa-birthday.ts --pessoas=<path> [--dry-run]
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ORGANIZATION_ID } from "@/scripts/agendor/users";
import { parseBirthDateInput } from "@/lib/birth-date";
import { buildCanonicalPersonMap, resolveCanonicalPersonId } from "@/scripts/agendor/phone-dedup";
import { loadSheet, getHeaders, colIndex, cellText, cellNumber } from "@/scripts/agendor/xlsx-utils";
import { runConcurrent } from "@/scripts/agendor/concurrency";
import { findAllPaged } from "@/scripts/agendor/pagination";

const CONCURRENCY = 16;

function parseArgs(): { pessoas: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  const found = args.find((a) => a.startsWith("--pessoas="));
  const pessoas = found ? found.slice("--pessoas=".length) : undefined;
  const dryRun = args.includes("--dry-run");
  if (!pessoas) {
    console.error("Uso: npx tsx --env-file=.env scripts/agendor/backfill-pessoa-birthday.ts --pessoas=<path> [--dry-run]");
    process.exit(1);
  }
  return { pessoas, dryRun };
}

function buildBirthdayIso(diaMes: string | null, ano: number | null): string | null {
  if (!diaMes || !ano) return null;
  const match = diaMes.match(/^(\d{2})\/(\d{2})$/);
  if (!match) return null;
  const [, dd, mm] = match;
  return parseBirthDateInput(`${dd}/${mm}/${ano}`);
}

async function main() {
  const { pessoas, dryRun } = parseArgs();
  console.log(dryRun ? "🔎 MODO DRY-RUN — nada será gravado no banco.\n" : "⚠️  MODO REAL — gravando no banco.\n");

  await runWithTenant(ORGANIZATION_ID, async () => {
    const canonicalMap = await buildCanonicalPersonMap(pessoas);
    const sheet = await loadSheet(pessoas);
    const headers = getHeaders(sheet);
    const idxCodigo = colIndex(headers, "Código da pessoa");
    const idxAniversario = colIndex(headers, "Aniversário");
    const idxAnoNascimento = colIndex(headers, "Ano de nascimento");

    const existing = await findAllPaged((skip, take) =>
      prisma.contact.findMany({
        where: { organizationId: ORGANIZATION_ID, agendorContactId: { not: null } },
        select: { id: true, agendorContactId: true, birthDate: true },
        orderBy: { id: "asc" },
        skip,
        take,
      }),
    );
    const byAgendorId = new Map(existing.map((c) => [c.agendorContactId as string, c]));
    console.log(`Contatos já importados do Agendor: ${existing.length}`);

    let updated = 0;
    let skippedNoContact = 0;
    let skippedAlreadyFilled = 0;
    let skippedNoBirthdayInRow = 0;
    let skippedNonCanonical = 0;

    const rows: number[] = [];
    for (let r = 2; r <= sheet.rowCount; r++) rows.push(r);

    await runConcurrent(rows, CONCURRENCY, async (r) => {
      const row = sheet.getRow(r);
      const codigo = cellText(row, idxCodigo);
      if (!codigo) return;

      const canonical = resolveCanonicalPersonId(canonicalMap, codigo);
      if (canonical !== codigo) {
        skippedNonCanonical++;
        return;
      }

      const contact = byAgendorId.get(codigo);
      if (!contact) {
        skippedNoContact++;
        return;
      }

      const birthdayIso = buildBirthdayIso(cellText(row, idxAniversario), cellNumber(row, idxAnoNascimento));
      if (!birthdayIso) {
        skippedNoBirthdayInRow++;
        return;
      }

      if (contact.birthDate) {
        skippedAlreadyFilled++;
        return;
      }

      if (dryRun) {
        updated++;
        return;
      }

      await prisma.contact.update({
        where: { id: contact.id },
        // @db.Date = meia-noite UTC (ver lib/birthdays.ts: lê com getUTC*).
        data: { birthDate: new Date(`${birthdayIso}T00:00:00.000Z`) },
      });
      updated++;
    });

    console.log(`\nAtualizados: ${updated}`);
    console.log(`Sem Contact correspondente (não importado): ${skippedNoContact}`);
    console.log(`Linha não-canônica (duplicata de telefone): ${skippedNonCanonical}`);
    console.log(`Sem dia/mês+ano de nascimento na linha: ${skippedNoBirthdayInRow}`);
    console.log(`Já tinha data de nascimento preenchida: ${skippedAlreadyFilled}`);
    console.log(dryRun ? "\n(dry-run — nada foi gravado)" : "\n✅ Concluído.");
  });
}

main()
  .catch((err) => {
    console.error("\n❌ Falhou:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
