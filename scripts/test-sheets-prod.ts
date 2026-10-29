/**
 * Teste de ponta a ponta das Planilhas no banco REAL (usa o usuário da
 * aplicação, com RLS). Cria uma planilha "[TESTE] …", exercita tudo e APAGA
 * a planilha no fim (cascade leva colunas/linhas/vínculos/histórico). Não
 * altera nenhum dado existente — o cliente usado no vínculo só é lido.
 *
 *   node --experimental-transform-types --import ./scripts/alias-loader.mjs scripts/test-sheets-prod.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { prisma, prismaRaw } from "@/lib/prisma";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import { clearColumns, createColumn, createSheet, getSheet, listSheets, setColumnArchived, updateColumn, updateSheet } from "@/lib/sheets/sheets";
import { insertRows, linkedRows, queryRows, rowHistory, setRowsDeleted, setRowsDeletedDetailed, summarizeRows, updateRows } from "@/lib/sheets/rows";
import { recalcSheetOnServer } from "@/lib/sheets/recalc";
import { exportSheetXlsx } from "@/lib/sheets/io";
import ExcelJS from "exceljs";
import { SheetError } from "@/lib/sheets/errors";

const ORG = process.env.TEST_ORG_ID ?? "cmr9i96330001ekvpb3b4o4nn";

async function main() {
  const owner = await runWithTenant(ORG, () =>
    prisma.organizationUser.findFirst({ where: { organizationId: ORG, role: "OWNER", active: true }, select: { userId: true } }),
  );
  assert.ok(owner, "dono não encontrado");
  const contact = await runWithTenant(ORG, () => prisma.contact.findFirst({ where: { organizationId: ORG }, select: { id: true } }));
  assert.ok(contact, "nenhum cliente para testar vínculo");
  const actor = { organizationId: ORG, userId: owner.userId, actorName: "Teste automatizado", source: "app" };

  const { id } = await createSheet(actor, {
    name: `[TESTE] Planilhas ${new Date().toISOString()}`,
    columns: [
      { name: "Nome", type: "TEXT", required: true },
      { name: "Status", type: "SELECT", config: { options: ["Pendente", "Ok"] } },
      { name: "Valor", type: "CURRENCY" },
      { name: "Vencimento", type: "DATE" },
      { name: "Cliente", type: "CONTACT" },
    ],
  });
  // Planilha nova em branco (sem colunas), como no Excel.
  const blankSheet = await createSheet(actor, { name: `[TESTE] em branco ${Date.now()}` });
  assert.equal((await getSheet(ORG, blankSheet.id)).columns.length, 0);
  await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, ORG);
    await tx.sheet.delete({ where: { id: blankSheet.id } });
  });
  let ok = 0;
  const step = (name: string) => console.log(`✔ ${++ok}. ${name}`);
  try {
    const sheet = await getSheet(ORG, id);
    const [cNome, cStatus, cValor, cVenc, cCliente] = sheet.columns.map((c) => c.id);
    step("criar planilha com 5 colunas tipadas");

    const rows = await insertRows(actor, id, [
      { [cNome]: "Ana", [cStatus]: "Pendente", [cValor]: "R$ 1.500,00", [cVenc]: "10/11/2026", [cCliente]: contact.id },
      { [cNome]: "Bruno", [cStatus]: "Ok", [cValor]: 300 },
      { [cNome]: "Carla", [cStatus]: "Pendente", [cValor]: "2.000" },
    ]);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].values[cValor], 1500);
    assert.equal(rows[0].values[cVenc], "2026-11-10");
    step("inserir 3 linhas (moeda e data em formato brasileiro convertidos)");

    await assert.rejects(insertRows(actor, id, [{ [cStatus]: "Talvez", [cNome]: "X" }]), SheetError);
    await assert.rejects(insertRows(actor, id, [{ [cStatus]: "Ok" }]), SheetError);
    await assert.rejects(insertRows(actor, id, [{ [cNome]: "X", [cCliente]: "cxxxxxxxxxxxxxxxxxxxxxxxx" }]), SheetError);
    step("recusar opção inválida, obrigatória vazia e cliente inexistente");

    const pend = await queryRows(ORG, id, { filters: [{ columnId: cStatus, op: "eq", value: "Pendente" }], sort: [{ columnId: cValor, dir: "desc" }] });
    assert.deepEqual(pend.rows.map((r) => r.values[cNome]), ["Carla", "Ana"]);
    assert.equal(pend.total, 2);
    const big = await queryRows(ORG, id, { filters: [{ columnId: cValor, op: "gte", value: 1000 }] });
    assert.equal(big.total, 2);
    const empty = await queryRows(ORG, id, { filters: [{ columnId: cVenc, op: "empty" }] });
    assert.equal(empty.total, 2);
    const search = await queryRows(ORG, id, { search: "bru" });
    assert.equal(search.total, 1);
    const any = await queryRows(ORG, id, { match: "any", filters: [{ columnId: cNome, op: "eq", value: "Ana" }, { columnId: cNome, op: "contains", value: "arl" }] });
    assert.equal(any.total, 2);
    step("filtros (igual, maior/igual, vazio, busca, 'qualquer') e ordenação numérica");

    const sum = await summarizeRows(ORG, id, { groupBy: cStatus, metrics: [{ fn: "count" }, { columnId: cValor, fn: "sum" }] });
    const pendente = sum.find((g) => g.group === "Pendente");
    assert.deepEqual(pendente?.values, [2, 3500]);
    step("resumo agrupado (quantidade e soma por status)");

    const linked = await linkedRows(ORG, { contactId: contact.id });
    assert.ok(linked.some((s) => s.sheet.id === id && s.rows.length === 1));
    step("vínculo com cliente aparece na busca reversa");

    const upd = await updateRows(actor, id, [{ id: rows[1].id, values: { [cStatus]: "Pendente", [cValor]: null } }]);
    assert.equal(upd[0].values[cStatus], "Pendente");
    assert.equal(upd[0].values[cValor], undefined);
    step("atualizar células (mudar status, esvaziar valor)");

    await setRowsDeleted(actor, id, [rows[0].id], true);
    assert.equal((await queryRows(ORG, id)).total, 2);
    assert.equal((await linkedRows(ORG, { contactId: contact.id })).some((s) => s.sheet.id === id), false);
    await setRowsDeleted(actor, id, [rows[0].id], false);
    assert.equal((await queryRows(ORG, id)).total, 3);
    assert.ok((await linkedRows(ORG, { contactId: contact.id })).some((s) => s.sheet.id === id));
    step("lixeira e restaurar (vínculo sai e volta junto)");

    const col = await createColumn(actor, id, { name: "Código", type: "TEXT" });
    await updateRows(actor, id, [{ id: rows[0].id, values: { [col.id]: "123" } }, { id: rows[1].id, values: { [col.id]: "abc" } }]);
    await assert.rejects(updateColumn(actor, id, col.id, { type: "NUMBER" }), (e: unknown) => e instanceof SheetError && e.status === 409);
    await updateColumn(actor, id, col.id, { type: "NUMBER", force: true });
    const after = await queryRows(ORG, id, { filters: [{ columnId: col.id, op: "notEmpty" }] });
    assert.equal(after.total, 1);
    assert.equal(after.rows[0].values[col.id], 123);
    step("trocar tipo de coluna: 409 com valor incompatível, force converte e limpa só o inválido");

    await setColumnArchived(actor, id, col.id, true);
    assert.equal((await getSheet(ORG, id)).columns.length, 5);
    await updateSheet(actor, id, { name: `[TESTE] renomeada ${Date.now()}` });
    step("arquivar coluna e renomear planilha");

    const hist = await rowHistory(ORG, id, { rowId: rows[1].id });
    assert.ok(hist.some((h) => h.action === "ROW_UPDATED" && h.userName));
    step(`histórico por linha (${hist.length} registros, com nome de quem mudou)`);

    await updateRows(actor, id, [{ id: rows[0].id, formats: { [cNome]: { b: true, fill: "#FFFF00" } } }]);
    const fmt = await queryRows(ORG, id, { filters: [{ columnId: cNome, op: "eq", value: "Ana" }] });
    assert.deepEqual(fmt.rows[0].formats[cNome], { b: true, fill: "#FFFF00" });
    await assert.rejects(updateRows(actor, id, [{ id: rows[0].id, formats: { [cNome]: { fill: "vermelho" } } }]), SheetError);
    await updateRows(actor, id, [{ id: rows[0].id, formats: { [cNome]: null } }]);
    assert.equal((await queryRows(ORG, id, { filters: [{ columnId: cNome, op: "eq", value: "Ana" }] })).rows[0].formats[cNome], undefined);
    step("marcações de célula: gravar, recusar cor inválida, limpar");

    const withEmpty = await queryRows(ORG, id, { filters: [{ columnId: cVenc, op: "in", value: [null, "10/11/2026"] }] });
    assert.equal(withEmpty.total, 3);
    step("AutoFiltro: lista com (Vazias)");

    await updateSheet(actor, id, { settings: { table: { style: "medium-7", totals: true, totalsFns: { [cValor]: "sum" } } } });
    await assert.rejects(updateSheet(actor, id, { settings: { table: { style: "nao-existe" } } }), SheetError);
    const saved = (await getSheet(ORG, id)).settings as { table?: { style?: string; totalsFns?: Record<string, string> } };
    assert.equal(saved.table?.style, "medium-7");
    assert.equal(saved.table?.totalsFns?.[cValor], "sum");
    step("Formatar como Tabela: salvar estilo/totais e recusar estilo inválido");

    // Fórmula em Valor (B) da linha do Bruno: dobro do Valor da linha de cima (Ana) — relativa, como no Excel.
    const brunoId = rows[1].id;
    await updateRows(actor, id, [{ id: brunoId, formulas: { [cValor]: `=⟦${cValor}|~-1⟧*2` }, values: { [cValor]: 3000 } }]);
    const withF = await queryRows(ORG, id, { filters: [{ columnId: cNome, op: "eq", value: "Bruno" }] });
    assert.equal(withF.rows[0].formulas[cValor], `=⟦${cValor}|~-1⟧*2`);
    assert.equal(withF.rows[0].rank, 2);
    assert.equal(withF.hasFormulas, true);
    assert.equal(withF.allTotal, 3);
    await assert.rejects(updateRows(actor, id, [{ id: brunoId, formulas: { [cStatus]: "=1+1" } }]), SheetError);
    await assert.rejects(updateRows(actor, id, [{ id: brunoId, formulas: { [cValor]: "sem igual" } }]), SheetError);
    step("fórmulas: gravar (formato interno), posição real da linha, recusar em coluna de seleção e texto sem '='");

    const [nova] = await insertRows(actor, id, [{ [cNome]: "Duda" }], [{ formats: { [cNome]: { b: true, color: "#C00000" } }, formulas: { [cValor]: `=⟦${cValor}|$2⟧+1` } }]);
    assert.deepEqual(nova.formats[cNome], { b: true, color: "#C00000" });
    assert.equal(nova.formulas[cValor], `=⟦${cValor}|$2⟧+1`);
    await setRowsDeleted(actor, id, [nova.id], true);
    step("linha nova já com marcação e fórmula (colar do Excel / digitar fórmula na linha vazia)");


    const xlsx = await exportSheetXlsx(ORG, id);
    assert.equal(xlsx.rowCount, 3);
    assert.ok(xlsx.buffer.byteLength > 1000);
    // Lê o .xlsx de volta (arquivo gerado por nós mesmos): a fórmula continua viva, em inglês, e a tabela existe.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.buffer);
    const ws = wb.worksheets[0];
    const brunoRow = ws.getColumn(1).values.findIndex((v) => v === "Bruno");
    const cellB = ws.getCell(brunoRow, sheet.columns.findIndex((c) => c.id === cValor) + 1).value as { formula?: string; result?: unknown };
    const valorLetter = String.fromCharCode(65 + sheet.columns.findIndex((c) => c.id === cValor));
    assert.equal(cellB.formula, `${valorLetter}${brunoRow - 1}*2`);
    assert.equal(cellB.result, 3000);
    assert.ok(Object.keys((ws as unknown as { tables: object }).tables ?? {}).length > 0 || (ws as unknown as { getTables?: () => unknown[] }).getTables?.().length, "tabela do Excel no arquivo");
    step("exportar .xlsx: tabela do Excel, fórmula viva em inglês (C2*2) com resultado, marcações");

    // Recálculo no servidor (escrita via API v1/importação não passa pela tela).
    await updateRows(actor, id, [{ id: rows[0].id, values: { [cValor]: 1000 } }]);
    assert.ok((await recalcSheetOnServer(ORG, id)) >= 1);
    const recalced = await queryRows(ORG, id, { filters: [{ columnId: cNome, op: "eq", value: "Bruno" }] });
    assert.equal(recalced.rows[0].values[cValor], 2000);
    assert.equal(await recalcSheetOnServer(ORG, id), 0); // nada mudou: não grava de novo
    step("recálculo no servidor: Bruno (=valor de cima × 2) acompanha a Ana sem abrir a tela");

    // Excluir a linha de cima: a fórmula relativa do Bruno aponta para ela → #REF! (como no Excel); desfazer devolve.
    const delAna = await setRowsDeletedDetailed(actor, id, [rows[0].id], true);
    const brunoAfter = (await queryRows(ORG, id, { filters: [{ columnId: cNome, op: "eq", value: "Bruno" }] })).rows[0];
    assert.equal(brunoAfter.formulas[cValor], "=#REF!*2");
    assert.ok(delAna.formulaChanges.some((ch) => ch.rowId === brunoAfter.id && ch.before === `=⟦${cValor}|~-1⟧*2`));
    await setRowsDeletedDetailed(actor, id, [rows[0].id], false);
    await updateRows(actor, id, [{ id: brunoAfter.id, formulas: { [cValor]: `=⟦${cValor}|~-1⟧*2` } }]);
    assert.equal((await queryRows(ORG, id, { filters: [{ columnId: cNome, op: "eq", value: "Bruno" }] })).rows[0].formulas[cValor], `=⟦${cValor}|~-1⟧*2`);
    step("excluir linha reescreve fórmulas (#REF!) e devolve as mudanças para o Ctrl+Z");

    // Trocar Valor para Seleção (não aceita fórmula): a fórmula conta como valor que não cabe (409) e sai com force.
    await assert.rejects(updateColumn(actor, id, cValor, { type: "SELECT", config: { options: ["x"] } }), (e: unknown) => e instanceof SheetError && e.status === 409);
    await updateColumn(actor, id, cValor, { type: "SELECT", config: { options: ["x"] }, force: true });
    const noFormula = await queryRows(ORG, id, { filters: [{ columnId: cNome, op: "eq", value: "Bruno" }] });
    assert.equal(noFormula.rows[0].formulas[cValor], undefined);
    step("trocar para tipo sem fórmula: 409 e, com force, fórmulas removidas (UPDATE em lote)");

    // Coluna sem título (como no Excel) + tabela só num intervalo (B2:C3 → colunas Status..Valor, linhas 2..3).
    const blank = await createColumn(actor, id, { name: "", type: "TEXT" });
    assert.equal(blank.name, "");
    const cur = await getSheet(ORG, id);
    const ids = cur.columns.map((c) => c.id);
    await updateSheet(actor, id, { settings: { table: { style: "medium-4", range: { c1: ids[1], c2: ids[2], r1: 2, r2: 3 } } } });
    await assert.rejects(updateSheet(actor, id, { settings: { table: { style: "medium-4", range: { c1: ids[1], c2: ids[2], r1: 0, r2: 3 } } } }), SheetError);
    const xr = await exportSheetXlsx(ORG, id);
    const wr = new ExcelJS.Workbook();
    await wr.xlsx.load(xr.buffer);
    const tbl = Object.values((wr.worksheets[0] as unknown as { tables: Record<string, { table: { tableRef?: string; ref?: string } }> }).tables)[0]?.table;
    assert.ok(tbl, "tabela no arquivo");
    assert.equal(tbl.tableRef ?? tbl.ref, "B2:C3");
    step("coluna sem título aceita; tabela só no intervalo B2:C3 (salva, validada e exportada assim)");

    // Como no Excel: limpar a coluna inteira (Delete pela letra) tira o conteúdo de todas as linhas, a coluna fica.
    const cleared = await clearColumns(actor, id, [cNome]);
    assert.ok(cleared >= 3);
    const afterClear = await queryRows(ORG, id, { limit: 50 });
    assert.ok(afterClear.rows.every((r) => r.values[cNome] === undefined && r.formats[cNome] === undefined));
    assert.ok((await getSheet(ORG, id)).columns.some((c) => c.id === cNome));
    // Excluir TODAS as colunas é permitido (a tela continua mostrando A…Z em branco).
    for (const c of (await getSheet(ORG, id)).columns) await setColumnArchived(actor, id, c.id, true);
    assert.equal((await getSheet(ORG, id)).columns.length, 0);
    assert.equal((await queryRows(ORG, id, { limit: 10 })).total, 3);
    step("limpar coluna inteira (todas as linhas) e excluir até a última coluna, como no Excel");

    const other = await runWithTenant("org-que-nao-existe", () => prisma.sheet.findMany({ where: { id } }));
    assert.equal(other.length, 0);
    const otherRows = await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, "org-que-nao-existe");
      return tx.$queryRaw<unknown[]>`SELECT id FROM "SheetRow" WHERE "sheetId" = ${id}`;
    });
    assert.equal(otherRows.length, 0);
    step("isolamento: outra organização não enxerga nada (nem por SQL cru)");

    assert.ok((await listSheets(ORG)).some((s) => s.id === id && s.rowCount === 3));
    step("listagem com contagem de linhas");
  } finally {
    await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, ORG);
      await tx.sheet.delete({ where: { id } });
    });
    const left = await runWithTenant(ORG, () => prisma.sheetRow.count({ where: { sheetId: id } }));
    console.log(`limpeza: planilha de teste apagada (linhas restantes: ${left})`);
  }
  console.log(`\nTODOS OS ${ok} PASSOS OK`);
}

main()
  .catch((err) => {
    console.error("FALHOU:", err);
    process.exitCode = 1;
  })
  .finally(() => prismaRaw.$disconnect());
