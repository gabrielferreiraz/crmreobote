/**
 * Conserta CPFs legados do campo personalizado "CPF" (Contact.customFieldValues[defId])
 * que a importação do Agendor gravou com defeito:
 *
 *  - ZERO À ESQUERDA PERDIDO: a planilha guarda CPF como número e o Excel come
 *    o zero ("03395004171" → "3395004171"; ver scripts/agendor/xlsx-utils.ts).
 *    Restaurado por restoreCpfLeadingZeros (lib/cpf.ts): 7–10 dígitos E o número
 *    completado passa nos dois dígitos verificadores. Valores de 5 dígitos NÃO
 *    são mexidos — são lixo, não zero perdido (a taxa de "acerto" deles, 2%, é
 *    a do acaso).
 *  - PONTUAÇÃO: CPF válido guardado como "123.456.789-09" vira só dígitos (a
 *    convenção do tipo CPF, igual ao CNPJ — ver lib/cpf.ts).
 *
 * Nunca inventa dado: só grava o que passa na validação de CPF. O que continua
 * inválido fica como está (e o servidor tolera valor legado inalterado, ver
 * validateCustomFieldValues em lib/custom-fields.ts).
 *
 *   npx tsx --env-file=.env scripts/repair-cpf-legacy.ts
 *       Simulação (padrão): mostra o que mudaria. Não grava nada.
 *   npx tsx --env-file=.env scripts/repair-cpf-legacy.ts --apply
 *       Grava. Backup em .scratch/ ANTES; cada UPDATE só vale se o valor ainda é
 *       o lido (edição no meio do caminho = aquele contato é pulado); confere
 *       tudo dentro da mesma transação e desfaz se algo divergir.
 *   npx tsx --env-file=.env scripts/repair-cpf-legacy.ts --rollback <backup.json>
 *       Devolve o valor antigo, só onde o valor atual ainda é o que o script gravou.
 *
 * SQL cru precisa de setTenantOnTx (RLS forçado: sem ele volta ZERO linhas em silêncio).
 */
import fs from "node:fs";
import path from "node:path";
import { prismaRaw } from "@/lib/prisma";
import { setTenantOnTx } from "@/lib/tenant-context";
import { isValidCpf, normalizeCpf, restoreCpfLeadingZeros } from "@/lib/cpf";

const ORG_ID = "cmr9i96330001ekvpb3b4o4nn";
const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes("--apply");
const ROLLBACK_IDX = ARGS.indexOf("--rollback");
const ROLLBACK_FILE = ROLLBACK_IDX >= 0 ? ARGS[ROLLBACK_IDX + 1] : null;
const BACKUP_DIR = path.join(process.cwd(), ".scratch");

type Change = { id: string; old: string; new: string; reason: "zeros" | "pontuacao" };

/** "***4171" — nunca imprime CPF inteiro no terminal. */
const tail = (v: string) => `***${normalizeCpf(v).slice(-4) || "?"}`;

async function main() {
  if (ROLLBACK_FILE) return rollback(ROLLBACK_FILE);
  await prismaRaw.$transaction(
    async (tx) => {
      await setTenantOnTx(tx, ORG_ID);
      const defs = await tx.customFieldDefinition.findMany({
        where: { organizationId: ORG_ID, entityType: "CONTACT", label: { equals: "CPF", mode: "insensitive" } },
        select: { id: true, type: true },
      });
      if (defs.length !== 1) throw new Error(`esperava exatamente 1 definição "CPF", achei ${defs.length} — abortando`);
      const def = defs[0];

      const rows = await tx.$queryRawUnsafe<{ id: string; v: string | null }[]>(
        `SELECT id, "customFieldValues"->>$1::text AS v FROM "Contact" WHERE jsonb_exists("customFieldValues", $1)`,
        def.id,
      );

      const changes: Change[] = [];
      let alreadyOk = 0;
      let empty = 0;
      const stillInvalid: Record<string, number> = {};
      const bump = (k: string) => (stillInvalid[k] = (stillInvalid[k] ?? 0) + 1);
      for (const r of rows) {
        const v = (r.v ?? "").trim();
        if (!v) {
          empty++;
          continue;
        }
        const digits = normalizeCpf(v);
        if (digits.length === 11 && isValidCpf(digits)) {
          if (v === digits) alreadyOk++;
          else changes.push({ id: r.id, old: r.v as string, new: digits, reason: "pontuacao" });
          continue;
        }
        const restored = restoreCpfLeadingZeros(v);
        if (restored) {
          changes.push({ id: r.id, old: r.v as string, new: restored, reason: "zeros" });
          continue;
        }
        bump(digits.length === 11 ? "11 dígitos, dígito verificador errado (ou repetidos)" : digits.length < 11 ? `${digits.length} dígitos, não recuperável` : "mais de 11 dígitos");
      }

      const zeros = changes.filter((c) => c.reason === "zeros");
      const punct = changes.filter((c) => c.reason === "pontuacao");
      console.log(`Campo "CPF" (${def.id}, tipo ${def.type}) — contatos com valor: ${rows.length - empty}`);
      console.log(`  já corretos (11 dígitos válidos, só números):  ${alreadyOk}`);
      console.log(`  REPARAR — zero(s) à esquerda restaurado(s):    ${zeros.length}`);
      console.log(`  REPARAR — CPF válido só normalizado (sem pontuação): ${punct.length}`);
      console.log(`  continuam inválidos (não mexo): ${Object.values(stillInvalid).reduce((a, b) => a + b, 0)}  ${JSON.stringify(stillInvalid)}`);
      for (const c of zeros.slice(0, 5)) console.log(`     zeros: ${tail(c.old)} (${normalizeCpf(c.old).length} dígitos) → 11 dígitos`);
      for (const c of punct.slice(0, 3)) console.log(`     pontuação: ${tail(c.old)} → só dígitos`);

      if (!APPLY) {
        console.log("\nSIMULAÇÃO — nada foi gravado. Rode com --apply pra gravar.");
        return;
      }
      if (changes.length === 0) {
        console.log("\nNada a reparar.");
        return;
      }

      const backup = writeBackup({ orgId: ORG_ID, defId: def.id, changes });
      console.log(`\nBackup gravado: ${backup}`);

      // Só atualiza se o valor ainda é o lido (`= v.old`): edição entre a leitura e a escrita não é pisada.
      const updated = await tx.$executeRawUnsafe(
        `UPDATE "Contact" c
            SET "customFieldValues" = jsonb_set(c."customFieldValues", ARRAY[$1::text], to_jsonb(v.new_value::text))
           FROM (SELECT unnest($2::text[]) AS id, unnest($3::text[]) AS old_value, unnest($4::text[]) AS new_value) v
          WHERE c.id = v.id AND c."customFieldValues"->>$1::text = v.old_value`,
        def.id,
        changes.map((c) => c.id),
        changes.map((c) => c.old),
        changes.map((c) => c.new),
      );
      console.log(`Atualizados: ${updated} de ${changes.length}`);
      if (updated !== changes.length) throw new Error(`Só ${updated}/${changes.length} bateram com o valor lido (alguém editou no meio?) — ROLLBACK, rode de novo.`);

      // Verificação: cada valor gravado é EXATAMENTE o esperado e é um CPF válido.
      const after = await tx.$queryRawUnsafe<{ id: string; v: string }[]>(
        `SELECT id, "customFieldValues"->>$1::text AS v FROM "Contact" WHERE id = ANY($2::text[])`,
        def.id,
        changes.map((c) => c.id),
      );
      const expected = new Map(changes.map((c) => [c.id, c.new]));
      const wrong = after.filter((a) => a.v !== expected.get(a.id) || !isValidCpf(a.v));
      if (after.length !== changes.length || wrong.length > 0) throw new Error(`${wrong.length} valor(es) gravado(s) diferente(s) do esperado — ROLLBACK.`);
      const stillJson = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "Contact" WHERE id = ANY($1::text[]) AND jsonb_typeof("customFieldValues") = 'object'`, changes.map((c) => c.id));
      if (Number(stillJson[0].n) !== changes.length) throw new Error("customFieldValues deixou de ser objeto JSON em algum contato — ROLLBACK.");
      console.log("Verificação OK: todos os valores gravados são idênticos ao esperado e são CPFs válidos. Transação confirmada.");
    },
    { timeout: 120000, maxWait: 30000 },
  );
}

function writeBackup(payload: unknown): string {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `cpf-repair-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(payload));
  return file;
}

async function rollback(file: string) {
  const backup = JSON.parse(fs.readFileSync(file, "utf8")) as { orgId: string; defId: string; changes: Change[] };
  if (backup.orgId !== ORG_ID) throw new Error("Backup de outra organização.");
  await prismaRaw.$transaction(
    async (tx) => {
      await setTenantOnTx(tx, ORG_ID);
      const restored = await tx.$executeRawUnsafe(
        `UPDATE "Contact" c
            SET "customFieldValues" = jsonb_set(c."customFieldValues", ARRAY[$1::text], to_jsonb(v.old_value::text))
           FROM (SELECT unnest($2::text[]) AS id, unnest($3::text[]) AS old_value, unnest($4::text[]) AS new_value) v
          WHERE c.id = v.id AND c."customFieldValues"->>$1::text = v.new_value`,
        backup.defId,
        backup.changes.map((c) => c.id),
        backup.changes.map((c) => c.old),
        backup.changes.map((c) => c.new),
      );
      console.log(`Desfeito: valor antigo devolvido em ${restored} de ${backup.changes.length} contatos (só onde ainda era o valor gravado pelo reparo).`);
    },
    { timeout: 120000, maxWait: 30000 },
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => process.exit(process.exitCode ?? 0));
