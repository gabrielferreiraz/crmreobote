/**
 * Backfill de aniversário nos Contact já importados do Agendor ANTES da
 * leitura de "Aniversário"/"Ano de nascimento" existir em import-pessoas.ts
 * (create-only — rodar a importação de novo não preenche quem já existe).
 *
 * Mesmo espírito conservador do backfill-pessoa-address.ts: só preenche
 * quem AINDA NÃO tem valor nesse campo personalizado (nunca sobrescreve),
 * e faz merge no JSON de customFieldValues (nunca apaga CPF ou qualquer
 * outro campo personalizado que já esteja lá).
 *
 * Uso: npx tsx --env-file=.env scripts/agendor/backfill-pessoa-birthday.ts --pessoas=<path> [--dry-run]
 */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { runWithTenant } from "@/lib/tenant-context";
import { ORGANIZATION_ID } from "@/scripts/agendor/users";
import { buildCanonicalPersonMap, resolveCanonicalPersonId } from "@/scripts/agendor/phone-dedup";
import { loadSheet, getHeaders, colIndex, cellText, cellNumber } from "@/scripts/agendor/xlsx-utils";
import { runConcurrent } from "@/scripts/agendor/concurrency";
import { findAllPaged } from "@/scripts/agendor/pagination";

const CONCURRENCY = 16;
const BIRTHDAY_FIELD_LABEL = "Aniversário";

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
  return `${ano}-${mm}-${dd}`;
}

async function main() {
  const { pessoas, dryRun } = parseArgs();
  console.log(dryRun ? "🔎 MODO DRY-RUN — nada será gravado no banco.\n" : "⚠️  MODO REAL — gravando no banco.\n");

  await runWithTenant(ORGANIZATION_ID, async () => {
    // Mesmo campo que import-pessoas.ts cria (ensureCustomFieldDefinition) —
    // cria aqui também se ainda não existir, pra este script não depender
    // de rodar a importação de novo só pra isso.
    let fieldDef = await prisma.customFieldDefinition.findFirst({
      where: { organizationId: ORGANIZATION_ID, entityType: "CONTACT", label: BIRTHDAY_FIELD_LABEL },
    });
    if (!fieldDef && !dryRun) {
      fieldDef = await prisma.customFieldDefinition.create({
        data: { organizationId: ORGANIZATION_ID, entityType: "CONTACT", label: BIRTHDAY_FIELD_LABEL, type: "DATE" },
      });
      console.log(`Campo personalizado "${BIRTHDAY_FIELD_LABEL}" criado (${fieldDef.id})`);
    }
    const fieldId = fieldDef?.id ?? "dry-run:aniversario-field";

    const canonicalMap = await buildCanonicalPersonMap(pessoas);
    const sheet = await loadSheet(pessoas);
    const headers = getHeaders(sheet);
    const idxCodigo = colIndex(headers, "Código da pessoa");
    const idxAniversario = colIndex(headers, "Aniversário");
    const idxAnoNascimento = colIndex(headers, "Ano de nascimento");

    const existing = await findAllPaged((skip, take) =>
      prisma.contact.findMany({
        where: { organizationId: ORGANIZATION_ID, agendorContactId: { not: null } },
        select: { id: true, agendorContactId: true, customFieldValues: true },
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

      const currentValues = (contact.customFieldValues as Record<string, unknown> | null) ?? {};
      if (currentValues[fieldId] != null && currentValues[fieldId] !== "") {
        skippedAlreadyFilled++;
        return;
      }

      if (dryRun) {
        updated++;
        return;
      }

      await prisma.contact.update({
        where: { id: contact.id },
        data: { customFieldValues: { ...currentValues, [fieldId]: birthdayIso } as Prisma.InputJsonValue },
      });
      updated++;
    });

    console.log(`\nAtualizados: ${updated}`);
    console.log(`Sem Contact correspondente (não importado): ${skippedNoContact}`);
    console.log(`Linha não-canônica (duplicata de telefone): ${skippedNonCanonical}`);
    console.log(`Sem dia/mês+ano de nascimento na linha: ${skippedNoBirthdayInRow}`);
    console.log(`Já tinha aniversário preenchido: ${skippedAlreadyFilled}`);
    console.log(dryRun ? "\n(dry-run — nada foi gravado)" : "\n✅ Concluído.");
  });
}

main()
  .catch((err) => {
    console.error("\n❌ Falhou:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
