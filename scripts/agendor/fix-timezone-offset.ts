/**
 * Correção retroativa do bug de fuso encontrado em 03/09 (ver cellDate em
 * xlsx-utils.ts): toda data/hora lida de uma planilha do Agendor foi
 * gravada 4h adiantada até agora (ExcelJS devolve o valor da célula como se
 * já fosse UTC, mas o Agendor mostra hora LOCAL de Campo Grande/MS — nunca
 * UTC). O código já foi corrigido (cellDate soma as 4h certas antes de
 * devolver); este script soma essas mesmas 4h em todo dado JÁ GRAVADO por
 * uma importação anterior, pra ficar certo em todo lugar, não só nas
 * próximas importações.
 *
 * Escopo — só linha com marca de origem do Agendor (agendorContactId/
 * agendorDealId/agendorTaskId, ou o log SYSTEM que syncExistingDeal escreve
 * pra negócio sincronizado): nunca toca em nada criado/editado direto no
 * CRM ao vivo, que já nasce no fuso certo.
 *
 * Ressalva conhecida (documentada, não resolvida por este script): se uma
 * Task de origem Agendor teve seu dueAt/completedAt EDITADO manualmente
 * aqui no CRM depois da importação (ex.: reagendar direto na Agenda, não no
 * Agendor), esse valor já está certo — e este script vai somar 4h nele
 * também, adiantando incorretamente. Baixo risco na prática (a maioria das
 * edições de reunião passa pelo fluxo de reagendamento, que cria uma Task
 * NOVA sem agendorTaskId — fica fora do escopo daqui), mas não é
 * impossível. Sem um jeito de distinguir "veio do Agendor, nunca tocado"
 * de "veio do Agendor, editado depois aqui" sem um log de auditoria por
 * campo, que não existe.
 *
 * Uso: npx tsx --env-file=.env scripts/agendor/fix-timezone-offset.ts [--dry-run]
 */
import { prismaRaw } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { setTenantOnTx } from "@/lib/tenant-context";
import { ORGANIZATION_ID } from "@/scripts/agendor/users";

type ColumnTarget = {
  table: string;
  column: string;
  where: string; // já inclui organizationId
  /** Já rodou de verdade em 03/09 (1ª execução deste script, antes da
   * colisão abaixo interromper) — marcado aqui pra reexecuções seguras do
   * script nunca somarem 4h de novo por engano num alvo já corrigido. */
  alreadyApplied?: boolean;
  /** Task.dueAt é a ÚNICA coluna com um índice único que enxerga a própria
   * coluna sendo corrigida (Task_owner_meeting_slot_unique, ownerId+dueAt
   * pra type=MEETING). Um UPDATE em massa comum bate nisso no meio do
   * caminho: encontrado na prática — 4 pares de tarefas MEETING (duplicata
   * real do Agendor, mesmo owner) onde a NOVA data de uma bate com a data
   * ANTIGA (ainda não corrigida) da outra do mesmo par. As duas ficam
   * corretas e diferentes no final (owner+dueAt nunca colide de verdade no
   * resultado), mas o Postgres verifica unicidade linha a linha durante o
   * UPDATE, não só no final da instrução — um UPDATE em massa comum (e até
   * um "afasta tudo 10 anos, depois volta" tentado antes) esbarra nisso de
   * qualquer jeito, porque o problema não é a ordem de duas passadas, é a
   * ordem interna que o Postgres escolhe pra processar as linhas dentro de
   * UMA instrução. Resolvido em resolveMeetingSlotCollisions abaixo: exclui
   * as poucas linhas em conflito do UPDATE em massa, e corrige elas uma por
   * uma numa ordem que nunca escreve num horário ainda ocupado (sempre a
   * "vítima" que está de saída primeiro, quem se muda pra lá depois). */
  meetingSlotCollision?: boolean;
};

/**
 * Só usado pra Task.dueAt (ver meetingSlotCollision acima). Acha todo par
 * (a, b) onde b.dueAt (ainda não corrigido) já é exatamente o valor que
 * a.dueAt viraria (+4h) — essas são as linhas que um UPDATE em massa
 * comum não consegue resolver de uma vez. Devolve os ids a EXCLUIR do
 * UPDATE em massa + a lista de updates individuais, já na ordem segura
 * (sempre quem está "de saída" do par antes de quem está "chegando").
 */
async function resolveMeetingSlotCollisions(
  tx: Prisma.TransactionClient,
): Promise<{ excludeIds: string[]; orderedUpdates: { id: string; newDueAt: Date }[] }> {
  // WHERE fixo (não reaproveita t.where) porque essa consulta faz JOIN de
  // "Task" com ela mesma — um `where` genérico sem alias bateria em
  // "column reference is ambiguous" (organizationId/agendorTaskId existem
  // nas duas metades do JOIN); mais simples escrever direto pro único caso
  // em que esta função é chamada (Task.dueAt, agendorTaskId IS NOT NULL).
  const pairs = await tx.$queryRawUnsafe<{ aId: string; bId: string; bDueAt: Date }[]>(`
    SELECT a.id AS "aId", b.id AS "bId", b."dueAt" AS "bDueAt"
    FROM "Task" a
    JOIN "Task" b
      ON b."ownerId" = a."ownerId"
      AND b.type = 'MEETING'
      AND b."dueAt" = a."dueAt" + INTERVAL '4 hours'
      AND b.id != a.id
    WHERE a."organizationId" = '${ORGANIZATION_ID}'
      AND a."agendorTaskId" IS NOT NULL
      AND a.type = 'MEETING'
      AND a."dueAt" IS NOT NULL
  `);
  if (pairs.length > 0) {
    console.log(`  ${pairs.length} par(es) em conflito de horário (duplicata do Agendor) — resolvendo individualmente:`);
  }
  const excludeIds: string[] = [];
  const orderedUpdates: { id: string; newDueAt: Date }[] = [];
  for (const p of pairs) {
    excludeIds.push(p.aId, p.bId);
    // b sai do lugar primeiro (pro slot que a quer ocupar ficar livre),
    // b também precisa de +4h igual todo mundo — seu novo valor é o dueAt
    // dela mesma +4h, calculado a partir do dueAt JÁ LIDO acima (não
    // precisa reconsultar).
    const bNew = new Date(p.bDueAt.getTime() + 4 * 60 * 60 * 1000);
    orderedUpdates.push({ id: p.bId, newDueAt: bNew });
    // a entra depois, exatamente no valor que b acabou de desocupar
    // (b.dueAt original == a.dueAt + 4h, por construção da consulta acima).
    orderedUpdates.push({ id: p.aId, newDueAt: p.bDueAt });
    console.log(`    Task ${p.bId} → ${bNew.toISOString()} (primeiro), depois Task ${p.aId} → ${p.bDueAt.toISOString()}`);
  }
  return { excludeIds, orderedUpdates };
}

const TARGETS: ColumnTarget[] = [
  { table: "Contact", column: "createdAt", where: `"organizationId" = '${ORGANIZATION_ID}' AND "agendorContactId" IS NOT NULL`, alreadyApplied: true },

  { table: "Deal", column: "startedAt", where: `"organizationId" = '${ORGANIZATION_ID}' AND "agendorDealId" IS NOT NULL`, alreadyApplied: true },
  { table: "Deal", column: "closedAt", where: `"organizationId" = '${ORGANIZATION_ID}' AND "agendorDealId" IS NOT NULL`, alreadyApplied: true },
  { table: "Deal", column: "stageEnteredAt", where: `"organizationId" = '${ORGANIZATION_ID}' AND "agendorDealId" IS NOT NULL`, alreadyApplied: true },
  { table: "Deal", column: "createdAt", where: `"organizationId" = '${ORGANIZATION_ID}' AND "agendorDealId" IS NOT NULL`, alreadyApplied: true },
  { table: "Deal", column: "updatedAt", where: `"organizationId" = '${ORGANIZATION_ID}' AND "agendorDealId" IS NOT NULL`, alreadyApplied: true },

  { table: "Task", column: "dueAt", where: `"organizationId" = '${ORGANIZATION_ID}' AND "agendorTaskId" IS NOT NULL`, meetingSlotCollision: true },
  { table: "Task", column: "completedAt", where: `"organizationId" = '${ORGANIZATION_ID}' AND "agendorTaskId" IS NOT NULL` },
  { table: "Task", column: "createdAt", where: `"organizationId" = '${ORGANIZATION_ID}' AND "agendorTaskId" IS NOT NULL` },
  { table: "Task", column: "updatedAt", where: `"organizationId" = '${ORGANIZATION_ID}' AND "agendorTaskId" IS NOT NULL` },

  // Activity criada pelo backfill de reunião/visita (agendorTaskId setado).
  { table: "Activity", column: "createdAt", where: `"organizationId" = '${ORGANIZATION_ID}' AND "agendorTaskId" IS NOT NULL` },
  // Activity de log "Sincronizado do Agendor: ..." (syncExistingDeal) — não
  // tem agendorTaskId, só dá pra achar pelo corpo do log.
  {
    table: "Activity",
    column: "createdAt",
    where: `"organizationId" = '${ORGANIZATION_ID}' AND type = 'SYSTEM' AND body LIKE 'Sincronizado do Agendor:%'`,
  },
];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(dryRun ? "🔎 MODO DRY-RUN — nada será gravado no banco.\n" : "⚠️  MODO REAL — gravando no banco.\n");

  // prismaRaw (não o `prisma` normal) de propósito: a extensão de RLS
  // (lib/prisma.ts) só intercepta operação de MODELO ($allModels /
  // $allOperations) — $queryRawUnsafe/$executeRawUnsafe no cliente raiz não
  // passam por ali, então nunca ganham o SET LOCAL da organização. Sem
  // isso, a RLS (FORCE ROW LEVEL SECURITY) esconde/bloqueia tudo em
  // silêncio — confirmado na prática: 1ª versão deste script "achou" 0
  // linha em toda tabela. setTenantOnTx é o jeito documentado (ver
  // lib/tenant-context.ts) de fazer esse SET LOCAL manualmente numa
  // transação com prismaRaw. Uma transação POR alvo (não uma só pra tudo)
  // — mesma preocupação de mini-transação curta já usada no resto da
  // migração (teto de 15s numa transação longa contra o banco remoto).
  for (const t of TARGETS) {
    if (t.alreadyApplied) {
      console.log(`${t.table}.${t.column}: já corrigido numa execução anterior — pulando.`);
      continue;
    }

    const [count, corrected] = await prismaRaw.$transaction(
      async (tx) => {
        await setTenantOnTx(tx, ORGANIZATION_ID);

        const [{ count: countRaw, min, max }] = await tx.$queryRawUnsafe<{ count: bigint; min: Date | null; max: Date | null }[]>(
          `SELECT count(*) AS count, min("${t.column}") AS min, max("${t.column}") AS max FROM "${t.table}" WHERE ${t.where} AND "${t.column}" IS NOT NULL`,
        );
        const count = Number(countRaw);
        console.log(
          `${t.table}.${t.column}: ${count} linha(s) a corrigir${count > 0 ? ` (intervalo atual: ${min?.toISOString()} .. ${max?.toISOString()})` : ""}`,
        );

        if (count === 0) return [count, 0];

        // Prévia dos pares em conflito conta mesmo em dry-run (só leitura,
        // ajuda a conferir antes de aplicar de verdade) — só a escrita de
        // verdade abaixo é que respeita dryRun.
        if (t.meetingSlotCollision) {
          const { excludeIds, orderedUpdates } = await resolveMeetingSlotCollisions(tx);
          if (dryRun) return [count, 0];
          const excludeClause = excludeIds.length > 0 ? `AND id NOT IN (${excludeIds.map((id) => `'${id}'`).join(",")})` : "";
          const bulkCorrected = await tx.$executeRawUnsafe(
            `UPDATE "${t.table}" SET "${t.column}" = "${t.column}" + INTERVAL '4 hours' WHERE ${t.where} AND "${t.column}" IS NOT NULL ${excludeClause}`,
          );
          // As excluídas, uma por uma, na ordem segura já calculada acima
          // (nunca escreve num horário que outra linha do lote ainda ocupa).
          for (const u of orderedUpdates) {
            await tx.$executeRawUnsafe(`UPDATE "Task" SET "dueAt" = '${u.newDueAt.toISOString()}' WHERE id = '${u.id}'`);
          }
          return [count, bulkCorrected + orderedUpdates.length];
        }

        if (dryRun) return [count, 0];

        const corrected = await tx.$executeRawUnsafe(
          `UPDATE "${t.table}" SET "${t.column}" = "${t.column}" + INTERVAL '4 hours' WHERE ${t.where} AND "${t.column}" IS NOT NULL`,
        );
        return [count, corrected];
      },
      // Timeout padrão (5s) estourou de verdade num UPDATE de ~72 mil
      // linhas contra o banco remoto — mesmo ajuste generoso já usado na
      // extensão de RLS (lib/prisma.ts) pro mesmo tipo de motivo.
      { maxWait: 10_000, timeout: 120_000 },
    );

    if (!dryRun && count > 0) console.log(`  ✅ ${corrected} linha(s) corrigida(s) em ${t.table}.${t.column}`);
  }

  console.log(dryRun ? "\n(dry-run — nada foi gravado)" : "\n✅ Concluído.");
}

main()
  .catch((err) => {
    console.error("\n❌ Falhou:", err);
    process.exit(1);
  })
  .finally(() => prismaRaw.$disconnect());
