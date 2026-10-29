/**
 * Mede o tempo do servidor das Planilhas no banco REAL: cria uma planilha
 * "[BENCH]" com N linhas, cronometra abrir/consultar/filtrar/buscar/resumir e
 * APAGA a planilha no fim (cascade).
 *
 *   node --experimental-transform-types --import ./scripts/alias-loader.mjs scripts/bench-sheets.ts [linhas]
 */
import "dotenv/config";
import { prisma, prismaRaw } from "@/lib/prisma";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import { createSheet, getSheet, listSheets } from "@/lib/sheets/sheets";
import { allRowsForCalc, insertRows, loadSheetColumnsTx, queryRows, queryRowsTx, summarizeRows } from "@/lib/sheets/rows";
import { listSheetTabs, openSheet } from "@/lib/sheets/open";
import { referenceNames } from "@/lib/sheets/io";

const ORG = process.env.TEST_ORG_ID ?? "cmr9i96330001ekvpb3b4o4nn";
const N = Number(process.argv[2] ?? 3000);

async function time<T>(label: string, fn: () => Promise<T>, runs = 3): Promise<T> {
  let out!: T;
  const ms: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    out = await fn();
    ms.push(performance.now() - t);
  }
  ms.sort((a, b) => a - b);
  console.log(`${label.padEnd(44)} mediana ${ms[Math.floor(ms.length / 2)].toFixed(0).padStart(5)} ms   (min ${ms[0].toFixed(0)})`);
  return out;
}

async function main() {
  const owner = await runWithTenant(ORG, () => prisma.organizationUser.findFirst({ where: { organizationId: ORG, role: "OWNER", active: true }, select: { userId: true } }));
  const actor = { organizationId: ORG, userId: owner!.userId, actorName: "Bench", source: "app" };
  const { id } = await createSheet(actor, {
    name: `[BENCH] ${new Date().toISOString()}`,
    columns: [
      { name: "Nome", type: "TEXT" },
      { name: "Status", type: "SELECT", config: { options: ["Pendente", "Ok", "Cancelado"] } },
      { name: "Valor", type: "CURRENCY" },
      { name: "Data", type: "DATE" },
      { name: "Obs", type: "TEXT" },
      { name: "Qtd", type: "NUMBER" },
    ],
  });
  try {
    const cols = (await getSheet(ORG, id)).columns;
    const [cNome, cStatus, cValor, cData, cObs, cQtd] = cols.map((c) => c.id);
    const t0 = performance.now();
    for (let start = 0; start < N; start += 1000) {
      const batch = Array.from({ length: Math.min(1000, N - start) }, (_, k) => {
        const i = start + k;
        return {
          [cNome]: `Cliente ${i}`,
          [cStatus]: ["Pendente", "Ok", "Cancelado"][i % 3],
          [cValor]: (i * 37) % 10000,
          [cData]: `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
          [cObs]: `observação ${i % 97}`,
          [cQtd]: i % 50,
        };
      });
      await insertRows(actor, id, batch);
    }
    console.log(`inseriu ${N} linhas em ${(performance.now() - t0).toFixed(0)} ms\n`);

    await time("abrir: getSheet", () => getSheet(ORG, id));
    await time("abrir: listSheets (abas)", () => listSheets(ORG));
    const page = await time("abrir: queryRows 200 linhas", () => queryRows(ORG, id, { limit: 200 }));
    await time("abrir: referenceNames", () => referenceNames(ORG, page.columns, page.rows));
    await time("abrir: TUDO em paralelo (como a página)", () =>
      Promise.all([getSheet(ORG, id), listSheets(ORG), queryRows(ORG, id, { limit: 200 })]),
    );
    await time("NOVO abrir: openSheet + abas em paralelo", () => Promise.all([openSheet(ORG, id), listSheetTabs(ORG)]));
    await time("NOVO fórmulas: planilha inteira num pedido", () => allRowsForCalc(ORG, id));
    // Custo do BANCO por comando (desconta a rede): ida e volta medida com SELECT 1 na mesma transação.
    await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, ORG);
      const rt = async () => { const t = performance.now(); await tx.$queryRaw`SELECT 1`; return performance.now() - t; };
      const rts = [await rt(), await rt(), await rt()].sort((a, b) => a - b)[1];
      if (process.env.NOJIT) await tx.$executeRaw`SET LOCAL jit = off`;
      const t1 = performance.now(); const { columns } = await loadSheetColumnsTx(tx, ORG, id); const colsMs = performance.now() - t1;
      const t2 = performance.now(); await queryRowsTx(tx, id, columns, { limit: 200 }); const pageMs = performance.now() - t2;
      const t3 = performance.now(); await queryRowsTx(tx, id, columns, { limit: 200, filters: [{ columnId: cValor, op: "gte", value: 5000 }], sort: [{ columnId: cValor, dir: "desc" }] }); const fMs = performance.now() - t3;
      console.log(`  [banco] ida e volta ${rts.toFixed(0)} ms · colunas +${Math.max(0, colsMs - rts).toFixed(0)} ms · página +${Math.max(0, pageMs - rts).toFixed(0)} ms · filtro+ordem +${Math.max(0, fMs - rts).toFixed(0)} ms`);
    }, { timeout: 60_000 });
    await time("rolar: próxima página (offset 2000)", () => queryRows(ORG, id, { limit: 200, offset: 2000 }));
    await time("filtro: Status = Ok", () => queryRows(ORG, id, { limit: 200, filters: [{ columnId: cStatus, op: "eq", value: "Ok" }] }));
    await time("filtro: Valor >= 5000 + ordenar Valor", () =>
      queryRows(ORG, id, { limit: 200, filters: [{ columnId: cValor, op: "gte", value: 5000 }], sort: [{ columnId: cValor, dir: "desc" }] }),
    );
    await time("busca: 'observação 42'", () => queryRows(ORG, id, { limit: 200, search: "observação 42" }));
    await time("AutoFiltro: valores distintos de Status", () => summarizeRows(ORG, id, { groupBy: cStatus, metrics: [{ fn: "count" }] }));
    await time("Totais: soma Valor + média Qtd", () => summarizeRows(ORG, id, { metrics: [{ columnId: cValor, fn: "sum" }, { columnId: cQtd, fn: "avg" }] }));
    await time("fórmulas: carregar planilha inteira (500/pág)", async () => {
      const all = [];
      for (let offset = 0; offset < N; offset += 500) all.push(...(await queryRows(ORG, id, { offset, limit: 500 })).rows);
      return all.length;
    }, 1);
  } finally {
    await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, ORG);
      await tx.sheet.delete({ where: { id } });
    });
    console.log("\nlimpeza: planilha de bench apagada");
  }
}

main()
  .catch((err) => {
    console.error("FALHOU:", err);
    process.exitCode = 1;
  })
  .finally(() => prismaRaw.$disconnect());
