/**
 * Backfill de endereço nos Contact já importados do Agendor ANTES da leitura
 * de endereço existir em import-pessoas.ts (create-only — rodar a
 * importação de novo não preenche quem já existe, ver comentário lá).
 *
 * Só preenche campo VAZIO (nunca sobrescreve um endereço já cadastrado,
 * seja de importação anterior, edição manual ou outra integração) — mesmo
 * espírito conservador do resto da migração (nunca apaga/sobrescreve dado
 * que já existe).
 *
 * Casa por Contact.agendorContactId — só processa a linha CANÔNICA de cada
 * grupo de telefone duplicado (mesmo phone-dedup.ts do resto da migração):
 * um Contact só existe pra linha canônica, então só o endereço DELA importa.
 *
 * Uso: npx tsx --env-file=.env scripts/agendor/backfill-pessoa-address.ts --pessoas=<path> [--dry-run]
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ORGANIZATION_ID } from "@/scripts/agendor/users";
import { buildCanonicalPersonMap, resolveCanonicalPersonId } from "@/scripts/agendor/phone-dedup";
import { loadSheet, getHeaders, colIndex, cellText } from "@/scripts/agendor/xlsx-utils";
import { runConcurrent } from "@/scripts/agendor/concurrency";
import { findAllPaged } from "@/scripts/agendor/pagination";

const CONCURRENCY = 16;

function parseArgs(): { pessoas: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  const found = args.find((a) => a.startsWith("--pessoas="));
  const pessoas = found ? found.slice("--pessoas=".length) : undefined;
  const dryRun = args.includes("--dry-run");
  if (!pessoas) {
    console.error("Uso: npx tsx --env-file=.env scripts/agendor/backfill-pessoa-address.ts --pessoas=<path> [--dry-run]");
    process.exit(1);
  }
  return { pessoas, dryRun };
}

async function main() {
  const { pessoas, dryRun } = parseArgs();
  console.log(dryRun ? "🔎 MODO DRY-RUN — nada será gravado no banco.\n" : "⚠️  MODO REAL — gravando no banco.\n");

  await runWithTenant(ORGANIZATION_ID, async () => {
    const canonicalMap = await buildCanonicalPersonMap(pessoas);

    const sheet = await loadSheet(pessoas);
    const headers = getHeaders(sheet);
    const idxCodigo = colIndex(headers, "Código da pessoa");
    const idxRua = colIndex(headers, "Rua");
    const idxNumero = colIndex(headers, "Número");
    const idxComplemento = colIndex(headers, "Complemento");
    const idxBairro = colIndex(headers, "Bairro");
    const idxCidade = colIndex(headers, "Cidade");
    const idxEstado = colIndex(headers, "Estado");
    const idxCep = colIndex(headers, "CEP");

    // Pré-carrega todo Contact já importado do Agendor com endereço ainda
    // vazio — mesmo padrão de paginação do resto da migração (banco remoto,
    // teto de 15s por mini-transação do RLS).
    const existing = await findAllPaged((skip, take) =>
      prisma.contact.findMany({
        where: { organizationId: ORGANIZATION_ID, agendorContactId: { not: null } },
        select: {
          id: true, agendorContactId: true,
          address: true, addressNumber: true, addressComplement: true, neighborhood: true, city: true, state: true, zipCode: true,
        },
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
    let skippedNoAddressInRow = 0;
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
        return; // linha não-canônica — o Contact é da linha canônica do grupo, não desta
      }

      const contact = byAgendorId.get(codigo);
      if (!contact) {
        skippedNoContact++;
        return;
      }

      const address = cellText(row, idxRua);
      const addressNumber = cellText(row, idxNumero);
      const addressComplement = cellText(row, idxComplemento);
      const neighborhood = cellText(row, idxBairro);
      const city = cellText(row, idxCidade);
      const state = cellText(row, idxEstado);
      const zipCode = cellText(row, idxCep);
      if (!address && !addressNumber && !addressComplement && !neighborhood && !city && !state && !zipCode) {
        skippedNoAddressInRow++;
        return;
      }

      // Só preenche o que já está vazio — nunca sobrescreve.
      const data: Record<string, string> = {};
      if (!contact.address && address) data.address = address;
      if (!contact.addressNumber && addressNumber) data.addressNumber = addressNumber;
      if (!contact.addressComplement && addressComplement) data.addressComplement = addressComplement;
      if (!contact.neighborhood && neighborhood) data.neighborhood = neighborhood;
      if (!contact.city && city) data.city = city;
      if (!contact.state && state) data.state = state;
      if (!contact.zipCode && zipCode) data.zipCode = zipCode;

      if (Object.keys(data).length === 0) {
        skippedAlreadyFilled++;
        return;
      }

      if (dryRun) {
        updated++;
        return;
      }

      await prisma.contact.update({ where: { id: contact.id }, data });
      updated++;
    });

    console.log(`\nAtualizados: ${updated}`);
    console.log(`Sem Contact correspondente (não importado): ${skippedNoContact}`);
    console.log(`Linha não-canônica (duplicata de telefone): ${skippedNonCanonical}`);
    console.log(`Sem nenhum dado de endereço na linha: ${skippedNoAddressInRow}`);
    console.log(`Já tinha todo endereço preenchido: ${skippedAlreadyFilled}`);
    console.log(dryRun ? "\n(dry-run — nada foi gravado)" : "\n✅ Concluído.");
  });
}

main()
  .catch((err) => {
    console.error("\n❌ Falhou:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
