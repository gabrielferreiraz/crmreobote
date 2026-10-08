/**
 * Checagem SOMENTE LEITURA em volta da migração Contact.updatedAt:
 *
 *   npx tsx --env-file=.env scripts/check-contact-updated-at.ts
 *
 * Roda ANTES e DEPOIS de aplicar a migração. Existe por causa da armadilha
 * documentada deste projeto: `prisma migrate dev` derruba em silêncio os
 * índices trigram/GIN (que o Prisma não modela) — então a conferência não é
 * só "a coluna nasceu?", é "nenhum índice sumiu no caminho?".
 *
 * Usa prismaRaw direto (sem runWithTenant): só lê catálogo do Postgres
 * (pg_indexes/information_schema), que não passa por RLS — diferente de
 * qualquer consulta a tabela de dado, onde faltar o tenant devolve 0 em
 * silêncio.
 */
import { prismaRaw } from "@/lib/prisma";
import { searchDb } from "@/lib/search-db";

const EXPECTED_SPECIAL_INDEXES = [
  "Contact_city_trgm_idx",
  "Contact_company_trgm_idx",
  "Contact_email_trgm_idx",
  "Contact_name_trgm_idx",
  "Contact_phoneNormalized_trgm_idx",
  "Contact_tags_gin_idx",
  "Contact_whatsappNormalized_trgm_idx",
];

async function main() {
  const columns = await prismaRaw.$queryRaw<{ column_name: string; is_nullable: string; column_default: string | null }[]>`
    SELECT column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'Contact' AND column_name IN ('createdAt', 'updatedAt')
    ORDER BY column_name
  `;
  console.log("\n— Colunas —");
  if (columns.length === 0) console.log("  (nenhuma encontrada — banco errado?)");
  for (const c of columns) {
    console.log(`  ${c.column_name}: nullable=${c.is_nullable} default=${c.column_default ?? "—"}`);
  }
  const hasUpdatedAt = columns.some((c) => c.column_name === "updatedAt");

  const indexes = await prismaRaw.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes WHERE tablename = 'Contact' ORDER BY indexname
  `;
  const names = indexes.map((i) => i.indexname);
  console.log(`\n— Índices de Contact (${names.length}) —`);
  for (const n of names) console.log(`  ${n}`);

  const missing = EXPECTED_SPECIAL_INDEXES.filter((i) => !names.includes(i));
  console.log("\n— Veredito —");
  console.log(`  updatedAt existe: ${hasUpdatedAt ? "sim" : "NÃO"}`);
  console.log(`  índice do filtro: ${names.includes("Contact_organizationId_updatedAt_idx") ? "sim" : "NÃO"}`);
  console.log(
    missing.length === 0
      ? "  índices trigram/GIN: todos presentes"
      : `  índices trigram/GIN: FALTANDO ${missing.join(", ")}`,
  );

  if (hasUpdatedAt) {
    // Conferência do backfill: nenhum contato pode ter ficado sem updatedAt,
    // e "updatedAt < createdAt" seria sinal de backfill errado.
    //
    // searchDb (BYPASSRLS, ver lib/search-db.ts), NÃO prismaRaw: tabela de
    // dado passa por RLS, e sem contexto de tenant a policy filtra tudo e o
    // COUNT volta 0 — zero que parece "tabela vazia" e não é (armadilha já
    // documentada neste projeto; a 1ª versão deste script caiu nela). As
    // consultas de catálogo acima podem seguir no prismaRaw: pg_indexes e
    // information_schema não têm RLS.
    const [stats] = await searchDb.$queryRaw<{ total: bigint; sem_updated: bigint; anterior_ao_create: bigint; iguais: bigint }[]>`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE "updatedAt" IS NULL) AS sem_updated,
        COUNT(*) FILTER (WHERE "updatedAt" < "createdAt") AS anterior_ao_create,
        COUNT(*) FILTER (WHERE "updatedAt" = "createdAt") AS iguais
      FROM "Contact"
    `;
    console.log(
      `  contatos: ${stats.total} · sem updatedAt: ${stats.sem_updated} · updatedAt<createdAt: ${stats.anterior_ao_create} · nunca alterados: ${stats.iguais}`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prismaRaw.$disconnect();
    await searchDb.$disconnect();
  });
