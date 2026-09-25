/**
 * EXECUTADO em produção em 2026-09-25 (FASE 1: 14.667 copiados; FASE 2: campo
 * "Aniversário" apagado, 14.670 chaves removidas — backups em .scratch/). Fica
 * no repositório como registro do que foi feito e pelo --rollback, que devolve
 * os valores e recria a definição (mesmo id) a partir do backup. Rodar de novo
 * é inofensivo: sem o campo, diz "não existe" e sai.
 *
 * Unifica o aniversário do cliente: copia o campo personalizado "Aniversário"
 * (CustomFieldDefinition CONTACT/DATE, valor "YYYY-MM-DD" em
 * Contact.customFieldValues[defId], gravado pela importação do Agendor) pra
 * coluna nativa Contact.birthDate ("Data de nascimento" na tela) — as duas
 * guardavam a MESMA coisa em lugares diferentes (ver memória
 * client-birthdays-data-split; achado B3 do relatório de QA).
 *
 * TRÊS modos, sempre em SIMULAÇÃO por padrão (nada é gravado sem flag):
 *
 *   npx tsx --env-file=.env scripts/migrate-birthdays-to-native.ts
 *       Simulação da FASE 1: classifica e mostra o que seria copiado.
 *   npx tsx --env-file=.env scripts/migrate-birthdays-to-native.ts --apply
 *       FASE 1 (aditiva): copia pro birthDate SÓ onde ele está vazio. Não apaga
 *       nada; o campo antigo continua intacto. Reversível (--rollback).
 *   npx tsx --env-file=.env scripts/migrate-birthdays-to-native.ts --retire
 *       Simulação da FASE 2. Com --apply junto, executa: tira o valor do campo
 *       antigo de cada contato (JSON) e apaga a definição. DESTRUTIVA — só roda
 *       se todo valor do campo já estiver refletido em birthDate, e grava
 *       backup completo antes. Depois disso a definição some dos formulários.
 *   npx tsx --env-file=.env scripts/migrate-birthdays-to-native.ts --rollback <backup.json>
 *       Desfaz a FASE 1 (volta birthDate pra NULL nos contatos copiados, só se
 *       o valor ainda for o copiado) e, se o backup for da FASE 2, restaura a
 *       definição e os valores do campo.
 *
 * Decisões (todas verificadas nos dados reais antes de escrever isto):
 *  - Se o contato JÁ tem birthDate, ele VALE (mesma regra de lib/birthdays.ts) —
 *    nunca sobrescreve. Se as duas divergem, só relata.
 *  - Só copia data válida (dia existe) com ano entre 1900 e hoje — o formulário
 *    de edição (lib/birth-date.ts) recusa o resto, então copiar um ano
 *    implausível travaria a edição do cliente. O que não passa fica no campo
 *    antigo e é listado.
 *  - SQL cru set-based (uma instrução por fase) em vez de 14 mil updates do
 *    Prisma. Precisa de setTenantOnTx — SQL cru fora dela devolve ZERO linhas
 *    em silêncio (RLS forçado; foi assim que uma primeira checagem "achou 0
 *    contatos" quando eram 14.670). Contact não tem coluna updatedAt, então não
 *    há data de atualização a preservar.
 *  - Uma transação só; verificação no fim; qualquer divergência dá rollback.
 *
 * Backup em .scratch/ (gitignored — tem id de cliente + data de nascimento).
 */
import fs from "node:fs";
import path from "node:path";
import { prismaRaw } from "@/lib/prisma";
import { setTenantOnTx } from "@/lib/tenant-context";

const ORG_ID = "cmr9i96330001ekvpb3b4o4nn";
const FIELD_LABEL = "Aniversário";
const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes("--apply");
const RETIRE = ARGS.includes("--retire");
const ROLLBACK_IDX = ARGS.indexOf("--rollback");
const ROLLBACK_FILE = ROLLBACK_IDX >= 0 ? ARGS[ROLLBACK_IDX + 1] : null;
const BACKUP_DIR = path.join(process.cwd(), ".scratch");

type Row = { id: string; native: Date | null; v: string | null };

function classify(value: string): "ok" | "format" | "nonexistent" | "year" | "future" {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "format";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return "nonexistent";
  if (y < 1900 || y > new Date().getUTCFullYear()) return "year";
  if (Date.UTC(y, mo - 1, d) > Date.now()) return "future";
  return "ok";
}

function writeBackup(name: string, payload: unknown): string {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(payload));
  return file;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  if (ROLLBACK_FILE) return rollback(ROLLBACK_FILE);
  await prismaRaw.$transaction(
    async (tx) => {
      await setTenantOnTx(tx, ORG_ID);

      const defs = await tx.customFieldDefinition.findMany({
        where: { organizationId: ORG_ID, entityType: "CONTACT", type: "DATE", label: { equals: FIELD_LABEL, mode: "insensitive" } },
        select: { id: true, label: true, type: true, entityType: true, required: true, order: true, options: true },
      });
      if (defs.length === 0) {
        console.log(`Campo "${FIELD_LABEL}" não existe (já foi aposentado?) — nada a fazer.`);
        return;
      }
      if (defs.length > 1) throw new Error(`Mais de uma definição "${FIELD_LABEL}" — abortando pra não adivinhar qual.`);
      const def = defs[0];

      const rows = await tx.$queryRawUnsafe<Row[]>(
        `SELECT id, "birthDate" AS native, "customFieldValues"->>$1::text AS v FROM "Contact" WHERE jsonb_exists("customFieldValues", $1)`,
        def.id,
      );

      const toCopy: { id: string; value: string }[] = [];
      const same: string[] = [];
      const conflicts: { id: string; native: string; field: string }[] = [];
      const skipped: { id: string; value: string; why: string }[] = [];
      let empty = 0;
      for (const r of rows) {
        const value = (r.v ?? "").trim();
        if (!value) {
          empty++;
          continue;
        }
        const kind = classify(value);
        if (kind !== "ok") {
          skipped.push({ id: r.id, value, why: kind });
          continue;
        }
        if (r.native) {
          if (ymd(r.native) === value) same.push(r.id);
          else conflicts.push({ id: r.id, native: ymd(r.native), field: value });
          continue;
        }
        toCopy.push({ id: r.id, value });
      }

      console.log(`Campo "${def.label}" (${def.id}) — contatos com a chave: ${rows.length}`);
      console.log(`  copiar pro birthDate (nativo vazio, data válida): ${toCopy.length}`);
      console.log(`  já iguais no birthDate:                            ${same.length}`);
      console.log(`  CONFLITO (nativo ≠ campo; o nativo vale, nada muda): ${conflicts.length}`);
      console.log(`  ignorados (valor vazio / formato / data inexistente / ano fora de 1900..hoje): ${empty + skipped.length}`);
      for (const c of conflicts.slice(0, 10)) console.log(`     conflito ${c.id}: nativo ${c.native} × campo ${c.field}`);
      for (const s of skipped.slice(0, 10)) console.log(`     ignorado ${s.id}: "${s.value}" (${s.why})`);

      const nativeBefore = Number((await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "Contact" WHERE "birthDate" IS NOT NULL`))[0].n);
      console.log(`  Contact.birthDate preenchido hoje: ${nativeBefore}  →  ficaria ${nativeBefore + toCopy.length}`);

      if (RETIRE) return retirePhase(tx, def, rows, skipped, empty, nativeBefore);

      if (!APPLY) {
        console.log("\nSIMULAÇÃO — nada foi gravado. Rode com --apply pra copiar.");
        return;
      }
      if (toCopy.length === 0) {
        console.log("\nNada a copiar.");
        return;
      }

      // Backup ANTES de escrever: id + valor copiado (e o valor original do campo).
      const backup = writeBackup("birthday-phase1", { orgId: ORG_ID, defId: def.id, phase: 1, copied: toCopy });
      console.log(`\nBackup gravado: ${backup}`);

      const ids = toCopy.map((c) => c.id);
      const updated = await tx.$executeRawUnsafe(
        `UPDATE "Contact" SET "birthDate" = ("customFieldValues"->>$1::text)::date WHERE id = ANY($2::text[]) AND "birthDate" IS NULL AND jsonb_exists("customFieldValues", $1)`,
        def.id,
        ids,
      );
      const nativeAfter = Number((await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "Contact" WHERE "birthDate" IS NOT NULL`))[0].n);
      console.log(`Atualizados: ${updated} | birthDate preenchido agora: ${nativeAfter}`);
      // Verificação: número esperado E amostra comparada linha a linha com o campo.
      if (updated !== toCopy.length || nativeAfter !== nativeBefore + toCopy.length) {
        throw new Error(`Divergência (esperado +${toCopy.length}, atualizou ${updated}, total ${nativeAfter}) — ROLLBACK.`);
      }
      const check = await tx.$queryRawUnsafe<{ bad: bigint }[]>(
        `SELECT count(*)::bigint AS bad FROM "Contact" WHERE id = ANY($2::text[]) AND "birthDate"::text <> ("customFieldValues"->>$1::text)`,
        def.id,
        ids,
      );
      if (Number(check[0].bad) !== 0) throw new Error(`${check[0].bad} contato(s) com birthDate diferente do campo — ROLLBACK.`);
      console.log("Verificação OK: todo birthDate copiado é idêntico ao valor do campo. Transação confirmada.");
    },
    { timeout: 180000, maxWait: 30000 },
  );
}

/** FASE 2 — destrutiva: tira o campo antigo. Roda dentro da mesma transação de `main`. */
async function retirePhase(
  tx: Parameters<Parameters<typeof prismaRaw.$transaction>[0]>[0],
  def: { id: string; label: string; type: string; entityType: string; required: boolean; order: number; options: string[] },
  rows: Row[],
  skipped: { id: string; value: string; why: string }[],
  empty: number,
  nativeBefore: number,
) {
  // Trava: só aposenta se TODO valor do campo estiver refletido em birthDate.
  const notMirrored = rows.filter((r) => {
    const value = (r.v ?? "").trim();
    return value && (!r.native || ymd(r.native) !== value);
  });
  console.log(`\nFASE 2 — aposentar o campo "${def.label}"`);
  console.log(`  valores do campo NÃO refletidos no birthDate: ${notMirrored.length} (precisa ser 0)`);
  if (notMirrored.length > 0) {
    console.log("  Abortado: rode a FASE 1 (--apply) primeiro e trate os conflitos/ignorados.");
    for (const r of notMirrored.slice(0, 10)) console.log(`     ${r.id}: campo "${r.v}" × birthDate ${r.native ? ymd(r.native) : "vazio"}`);
    return;
  }
  console.log(`  ignorados sem data válida (seriam perdidos ao apagar): ${skipped.length} de ${rows.length - empty} com valor`);
  if (skipped.length > 0) {
    console.log("  Abortado: há valores no campo que NÃO foram migrados — apagar o campo perderia esses dados.");
    return;
  }
  console.log(`  contatos que perderiam a chave do campo: ${rows.length} | Contact.birthDate preenchido: ${nativeBefore}`);
  if (!APPLY) {
    console.log("\nSIMULAÇÃO — nada foi gravado. Rode --retire --apply pra executar (grava backup completo antes).");
    return;
  }

  const backup = writeBackup("birthday-phase2", {
    orgId: ORG_ID,
    phase: 2,
    definition: def,
    values: rows.map((r) => ({ id: r.id, value: r.v })),
  });
  console.log(`\nBackup completo gravado: ${backup}`);

  const stripped = await tx.$executeRawUnsafe(
    `UPDATE "Contact" SET "customFieldValues" = "customFieldValues" - $1::text WHERE jsonb_exists("customFieldValues", $1)`,
    def.id,
  );
  const remaining = Number((await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "Contact" WHERE jsonb_exists("customFieldValues", $1)`, def.id))[0].n);
  const nativeAfter = Number((await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "Contact" WHERE "birthDate" IS NOT NULL`))[0].n);
  if (stripped !== rows.length || remaining !== 0 || nativeAfter !== nativeBefore) {
    throw new Error(`Divergência na FASE 2 (limpou ${stripped}/${rows.length}, restam ${remaining}, birthDate ${nativeBefore}→${nativeAfter}) — ROLLBACK.`);
  }
  await tx.customFieldDefinition.delete({ where: { id: def.id } });
  console.log(`Chave removida de ${stripped} contatos; birthDate intacto (${nativeAfter}); definição apagada. Transação confirmada.`);
}

async function rollback(file: string) {
  const backup = JSON.parse(fs.readFileSync(file, "utf8")) as
    | { phase: 1; orgId: string; defId: string; copied: { id: string; value: string }[] }
    | {
        phase: 2;
        orgId: string;
        definition: { id: string; label: string; type: "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT" | "CPF"; entityType: "CONTACT" | "DEAL"; required: boolean; order: number; options: string[] };
        values: { id: string; value: string | null }[];
      };
  if (backup.orgId !== ORG_ID) throw new Error("Backup de outra organização.");
  await prismaRaw.$transaction(
    async (tx) => {
      await setTenantOnTx(tx, ORG_ID);
      if (backup.phase === 1) {
        const ids = backup.copied.map((c) => c.id);
        // Só zera onde ainda é EXATAMENTE o valor que a migração copiou — se alguém editou depois, não pisa.
        const changed = await tx.$executeRawUnsafe(
          `UPDATE "Contact" SET "birthDate" = NULL WHERE id = ANY($2::text[]) AND "birthDate"::text = ("customFieldValues"->>$1::text)`,
          backup.defId,
          ids,
        );
        console.log(`FASE 1 desfeita: birthDate voltou a NULL em ${changed} de ${ids.length} contatos (o campo antigo não foi tocado).`);
        return;
      }
      // FASE 2: recria a definição com o MESMO id (as chaves antigas dependem dele) e devolve os valores.
      const d = backup.definition;
      await tx.customFieldDefinition.create({
        data: { id: d.id, organizationId: ORG_ID, label: d.label, type: d.type, entityType: d.entityType, required: d.required, order: d.order, options: d.options },
      });
      let restored = 0;
      for (let i = 0; i < backup.values.length; i += 1000) {
        const chunk = backup.values.slice(i, i + 1000).filter((v) => v.value !== null);
        restored += await tx.$executeRawUnsafe(
          `UPDATE "Contact" c SET "customFieldValues" = COALESCE(c."customFieldValues", '{}'::jsonb) || jsonb_build_object($1::text, v.value)
           FROM (SELECT unnest($2::text[]) AS id, unnest($3::text[]) AS value) v WHERE c.id = v.id`,
          d.id,
          chunk.map((c) => c.id),
          chunk.map((c) => c.value as string),
        );
      }
      console.log(`FASE 2 desfeita: definição "${d.label}" recriada e valor restaurado em ${restored} contatos.`);
    },
    { timeout: 180000, maxWait: 30000 },
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => process.exit(process.exitCode ?? 0));
