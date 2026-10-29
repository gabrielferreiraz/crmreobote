/**
 * Planilhas — regras de valor de célula e detecção de tipo na importação
 * (partes sem banco):
 *
 *   node --experimental-transform-types --import ./scripts/alias-loader.mjs --test scripts/test-sheets.ts
 *
 * (transform-types, não strip-types: lib/cnpj.ts usa parameter properties.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CellValueError,
  coerceCellValue,
  coerceRowPatch,
  isCheckboxLikeColumn,
  missingRequired,
  normalizeColumnConfig,
  parseLooseDate,
  parseLooseNumber,
  type ColumnLike,
  type SheetColumnType,
} from "../lib/sheets/column-types.ts";

const col = (type: SheetColumnType, config: unknown = {}, required = false): ColumnLike => ({ id: `c_${type}`, name: type, type, config, required });

test("números em formato brasileiro e internacional", () => {
  assert.equal(parseLooseNumber("1.234,56"), 1234.56);
  assert.equal(parseLooseNumber("R$ 1.234,56"), 1234.56);
  assert.equal(parseLooseNumber("1234.56"), 1234.56);
  assert.equal(parseLooseNumber("1.000"), 1000);
  assert.equal(parseLooseNumber("12,5%"), 12.5);
  assert.equal(parseLooseNumber("abc"), null);
  assert.equal(parseLooseNumber(""), null);
});

test("datas: DD/MM/AAAA, ISO e data impossível", () => {
  assert.equal(parseLooseDate("05/03/2026"), "2026-03-05");
  assert.equal(parseLooseDate("2026-03-05"), "2026-03-05");
  assert.equal(parseLooseDate("2026-03-05T10:00:00Z"), "2026-03-05");
  assert.equal(parseLooseDate("31/02/2026"), null);
  assert.equal(parseLooseDate("ontem"), null);
});

test("vazio vira undefined (chave removida), exceto checkbox", () => {
  assert.equal(coerceCellValue(col("TEXT"), ""), undefined);
  assert.equal(coerceCellValue(col("TEXT"), null), undefined);
  assert.equal(coerceCellValue(col("CHECKBOX"), ""), false);
  assert.equal(coerceCellValue(col("CHECKBOX"), "sim"), true);
});

test("TRUE/FALSE e equivalentes formam coluna de caixa de seleção", () => {
  assert.equal(isCheckboxLikeColumn(["TRUE", "FALSE", " true ", "false"]), true);
  assert.equal(isCheckboxLikeColumn(["SIM", "não", "VERDADEIRO", "FALSO"]), true);
  assert.equal(isCheckboxLikeColumn(["TRUE", "talvez"]), false);
  assert.equal(isCheckboxLikeColumn(["1", "0"]), false);
  assert.equal(isCheckboxLikeColumn(["", null, undefined]), false);
});

test("tipos com validação", () => {
  assert.equal(coerceCellValue(col("CURRENCY"), "R$ 2.500,00"), 2500);
  assert.equal(coerceCellValue(col("EMAIL"), " Fulano@Email.com "), "fulano@email.com");
  assert.equal(coerceCellValue(col("CPF"), "529.982.247-25"), "52998224725");
  assert.throws(() => coerceCellValue(col("CPF"), "111.111.111-11"), CellValueError);
  assert.throws(() => coerceCellValue(col("NUMBER"), "doze"), CellValueError);
  assert.throws(() => coerceCellValue(col("EMAIL"), "sem-arroba"), CellValueError);
});

test("link só aceita http(s) — nada de javascript:", () => {
  assert.equal(coerceCellValue(col("URL"), "reobote.com.br"), "https://reobote.com.br/");
  assert.throws(() => coerceCellValue(col("URL"), "javascript:alert(1)"), CellValueError);
});

test("seleção respeita as opções", () => {
  const sel = col("SELECT", { options: ["Pendente", "Ok"] });
  assert.equal(coerceCellValue(sel, "Ok"), "Ok");
  assert.throws(() => coerceCellValue(sel, "Talvez"), CellValueError);
  const multi = col("MULTI_SELECT", { options: ["A", "B", "C"] });
  assert.deepEqual(coerceCellValue(multi, "A; B, A"), ["A", "B"]);
  assert.throws(() => coerceCellValue(multi, ["A", "Z"]), CellValueError);
});

test("referência precisa ter cara de id (existência é conferida no banco)", () => {
  assert.equal(coerceCellValue(col("CONTACT"), "cmr9i96330001ekvpb3b4o4nn"), "cmr9i96330001ekvpb3b4o4nn");
  assert.throws(() => coerceCellValue(col("CONTACT"), "'; DROP TABLE x; --"), CellValueError);
});

test("texto acima do limite é recusado", () => {
  assert.throws(() => coerceCellValue(col("TEXT"), "x".repeat(1_001)), CellValueError);
  assert.equal((coerceCellValue(col("LONG_TEXT"), "x".repeat(5_000)) as string).length, 5_000);
});

test("patch: separa set/unset e recusa coluna desconhecida", () => {
  const cols = [col("TEXT"), col("NUMBER")];
  assert.deepEqual(coerceRowPatch(cols, { c_TEXT: "oi", c_NUMBER: "" }), { set: { c_TEXT: "oi" }, unset: ["c_NUMBER"] });
  assert.throws(() => coerceRowPatch(cols, { outra: 1 }), CellValueError);
});

test("obrigatória", () => {
  const cols = [col("TEXT", {}, true)];
  assert.equal(missingRequired(cols, {})?.id, "c_TEXT");
  assert.equal(missingRequired(cols, { c_TEXT: "x" }), null);
});

test("config por tipo: opções sem duplicata, lixo descartado", () => {
  assert.deepEqual(normalizeColumnConfig("SELECT", { options: ["A", "A", "B"], decimals: 2 }), { ok: true, config: { options: ["A", "B"] } });
  assert.deepEqual(normalizeColumnConfig("TEXT", { options: ["A"] }), { ok: true, config: {} });
  assert.equal(normalizeColumnConfig("NUMBER", { decimals: 99 }).ok, false);
});

// ─── Tela: formatação e copiar/colar com o Excel ─────────────────────
import {
  buildRowOffsets,
  clipboardText,
  columnLetter,
  displayCell,
  editText,
  extractStatNumber,
  parseClipboardGrid,
  parseNameBoxInput,
  removeFromSelection,
  rowAtOffset,
  type ClientColumn,
} from "../lib/sheets/format.ts";

const ccol = (type: SheetColumnType, config: unknown = {}): ClientColumn => ({ id: "x", name: type, type, config, required: false, position: 0 });

test("colar do Excel: tabulação, linhas e célula com quebra de linha entre aspas", () => {
  assert.deepEqual(parseClipboardGrid("a\tb\r\nc\td\r\n"), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(parseClipboardGrid('"linha 1\nlinha 2"\tx'), [["linha 1\nlinha 2", "x"]]);
  assert.deepEqual(parseClipboardGrid("só um"), [["só um"]]);
  assert.deepEqual(parseClipboardGrid('"diz ""oi"""'), [['diz "oi"']]);
});

test("letras de coluna como no Excel", () => {
  assert.equal(columnLetter(0), "A");
  assert.equal(columnLetter(25), "Z");
  assert.equal(columnLetter(26), "AA");
  assert.equal(columnLetter(701), "ZZ");
});

test("exibição por tipo (pt-BR)", () => {
  assert.equal(displayCell(ccol("CURRENCY"), 1500, {}), "R$ 1.500,00");
  assert.equal(displayCell(ccol("PERCENT"), 12.5, {}), "12,5%");
  assert.equal(displayCell(ccol("DATE"), "2026-11-10", {}), "10/11/2026");
  assert.equal(displayCell(ccol("CPF"), "52998224725", {}), "529.982.247-25");
  assert.equal(displayCell(ccol("CONTACT"), "abc", { abc: "Maria" }), "Maria");
  assert.equal(displayCell(ccol("CHECKBOX"), true, {}), "Sim");
});

test("editar e copiar usam vírgula decimal (o Excel brasileiro entende)", () => {
  assert.equal(editText(ccol("CURRENCY"), 1500.5), "1500,5");
  assert.equal(clipboardText(ccol("NUMBER"), 3.25, {}), "3,25");
  assert.equal(clipboardText(ccol("TEXT"), "a\tb\nc", {}), "a b c");
  // Ida e volta: o que a tela copia volta igual ao colar.
  assert.equal(coerceCellValue(col("CURRENCY"), editText(ccol("CURRENCY"), 1234.56)), 1234.56);
  assert.equal(coerceCellValue(col("DATE"), editText(ccol("DATE"), "2026-01-31")), "2026-01-31");
});

// ─── Formatação estilo Excel (marcações, paleta, Formatar como Tabela) ─
import {
  cellFormatSchema,
  cleanFormat,
  formatCss,
  readSheetSettings,
  sheetSettingsSchema,
  shade,
  TABLE_STYLES,
  TABLE_STYLE_BY_ID,
  themePaletteGrid,
  tint,
} from "../lib/sheets/formats.ts";

test("tons da paleta seguem a regra do Excel (clarear/escurecer)", () => {
  assert.equal(tint("#4472C4", 0.8), "#DAE3F3"); // Azul, Mais Claro 80% — igual ao Excel
  assert.equal(shade("#4472C4", 0.5), "#223962"); // Azul, Mais Escuro 50%
  const grid = themePaletteGrid();
  assert.equal(grid.length, 10);
  assert.ok(grid.every((col) => col.length === 6));
});

test("21 estilos de tabela com o nome do preset do .xlsx", () => {
  assert.equal(TABLE_STYLES.length, 21);
  assert.equal(TABLE_STYLE_BY_ID.get("medium-2")?.excelName, "TableStyleMedium2");
  assert.equal(TABLE_STYLE_BY_ID.get("light-1")?.excelName, "TableStyleLight1");
  assert.equal(TABLE_STYLE_BY_ID.get("dark-7")?.excelName, "TableStyleDark7");
  assert.equal(TABLE_STYLE_BY_ID.get("medium-2")?.header.fill, "#4472C4");
});

test("marcação: só chaves conhecidas, cor em hexadecimal, vazio some", () => {
  assert.deepEqual(cleanFormat({ b: true, i: false, fill: "#FFFF00" }), { b: true, fill: "#FFFF00" });
  assert.equal(cleanFormat({ b: false }), undefined);
  assert.equal(cellFormatSchema.safeParse({ fill: "red" }).success, false);
  assert.equal(cellFormatSchema.safeParse({ fill: "url(javascript:alert(1))" }).success, false);
  assert.equal(cellFormatSchema.safeParse({ onclick: "x" }).success, false);
  assert.equal(cellFormatSchema.safeParse({ borderBottom: { style: "thick", color: "#107C41" } }).success, true);
  assert.equal(cellFormatSchema.safeParse({ borderBottom: { style: "inventada" } }).success, false);
  assert.equal(cellFormatSchema.safeParse({ borderBottom: { style: "thin", width: 99 } }).success, false);
  assert.deepEqual(cleanFormat({ borderTop: { style: "thin" }, borderBottom: { style: "thick", color: "#107C41" } }), {
    borderTop: { style: "thin" },
    borderBottom: { style: "thick", color: "#107C41" },
  });
  assert.deepEqual(formatCss({ b: true, align: "center" }), {
    fontWeight: 700,
    fontStyle: undefined,
    textDecoration: undefined,
    color: undefined,
    backgroundColor: undefined,
    justifyContent: "center",
    borderTop: undefined,
    borderRight: undefined,
    borderBottom: undefined,
    borderLeft: undefined,
  });
  assert.equal(formatCss({ borderBottom: { style: "thick", color: "#107C41" } })?.borderBottom, "3px solid #107C41");
});

test("configuração da tabela: estilo precisa existir; lixo vira 'sem tabela'", () => {
  assert.equal(sheetSettingsSchema.safeParse({ table: { style: "medium-2" } }).success, true);
  assert.equal(sheetSettingsSchema.safeParse({ table: { style: "inventado" } }).success, false);
  assert.deepEqual(readSheetSettings({ table: { style: "x" } }), {});
  const ok = readSheetSettings({ table: { style: "light-3", totals: true, totalsFns: { c1: "sum" } } });
  assert.equal(ok.table?.banded, true);
  assert.equal(ok.table?.totalsFns.c1, "sum");
});

// ─── Integração manual CRM ↔ Planilhas ──────────────────────────────
import {
  CRM_CONNECTORS,
  buildCrmUpdatePayload,
  isCompatibleCrmColumn,
} from "../lib/sheets/crm-integration.ts";

test("conectores do CRM expõem identidade tipada e só campos liberados", () => {
  assert.equal(CRM_CONNECTORS.contacts.identity.type, "CONTACT");
  assert.equal(CRM_CONNECTORS.deals.identity.type, "DEAL");
  assert.equal(CRM_CONNECTORS.contacts.fields.find((field) => field.key === "createdAt")?.writable, false);
  assert.equal(CRM_CONNECTORS.deals.fields.find((field) => field.key === "value")?.writable, true);
});

test("mapeamento CRM aceita tipos equivalentes sem abrir referências incompatíveis", () => {
  const description = CRM_CONNECTORS.deals.fields.find((field) => field.key === "description")!;
  const value = CRM_CONNECTORS.deals.fields.find((field) => field.key === "value")!;
  const client = CRM_CONNECTORS.deals.fields.find((field) => field.key === "contactId")!;
  assert.equal(isCompatibleCrmColumn(description, "TEXT"), true);
  assert.equal(isCompatibleCrmColumn(value, "NUMBER"), true);
  assert.equal(isCompatibleCrmColumn(client, "USER"), false);
});

test("envio ao CRM ignora vazio, campo somente leitura e converte tags", () => {
  const payload = buildCrmUpdatePayload(
    "contacts",
    [
      { fieldKey: "name", columnId: "c1" },
      { fieldKey: "email", columnId: "c2" },
      { fieldKey: "tags", columnId: "c3" },
      { fieldKey: "createdAt", columnId: "c4" },
    ],
    { c1: "Maria", c2: "", c3: "VIP; Indicação, VIP", c4: "2026-10-28" },
  );
  assert.deepEqual(payload, { name: "Maria", tags: ["VIP", "Indicação"] });
});

// ─── Enviar ao CRM: pré-checagem (claude, revisão da 11ª rodada) ─────
import { contactWriteCheck, CRM_CONNECTORS as CONNECTORS_CHECK } from "../lib/sheets/crm-integration.ts";

test("Enviar ao CRM: cliente sem responsável não é enviado por padrão para Consultor/Administrativo", () => {
  assert.equal(contactWriteCheck("MEMBER", null), "claim");
  assert.equal(contactWriteCheck("MEMBER", "outro"), "ok"); // a API decide (co-responsável pode)
  assert.equal(contactWriteCheck("OWNER", null), "ok");
  assert.equal(contactWriteCheck("MANAGER", null), "ok");
});

test("Status do negócio é só leitura (Ganho/Perdido têm fluxo próprio no CRM)", () => {
  const status = CONNECTORS_CHECK.deals.fields.find((f) => f.key === "status")!;
  assert.equal(status.writable, false);
  assert.deepEqual((status.config as { options: string[] }).options, ["Em andamento", "Ganho", "Perdido"]);
});

// ─── Seleção múltipla: Caixa de Nome e remoção com Ctrl+clique ───────
test("Caixa de Nome: célula única, intervalo, colunas (A:C), linhas (2:5) e múltiplos intervalos", () => {
  assert.deepEqual(parseNameBoxInput("B12"), [{ kind: "cells", r1: 12, r2: 12, c1: 1, c2: 1 }]);
  assert.deepEqual(parseNameBoxInput("D10:A2"), [{ kind: "cells", r1: 2, r2: 10, c1: 0, c2: 3 }]);
  assert.deepEqual(parseNameBoxInput("A:C"), [{ kind: "cols", c1: 0, c2: 2 }]);
  assert.deepEqual(parseNameBoxInput("C:C"), [{ kind: "cols", c1: 2, c2: 2 }]);
  assert.deepEqual(parseNameBoxInput("2:5"), [{ kind: "rows", r1: 2, r2: 5 }]);
  assert.deepEqual(parseNameBoxInput("A2:B5; D2:D5, F:G"), [
    { kind: "cells", r1: 2, r2: 5, c1: 0, c2: 1 },
    { kind: "cells", r1: 2, r2: 5, c1: 3, c2: 3 },
    { kind: "cols", c1: 5, c2: 6 },
  ]);
  assert.equal(parseNameBoxInput(""), null);
  assert.equal(parseNameBoxInput("invalido"), null);
  assert.equal(parseNameBoxInput("A2:invalido"), null);
});

test("removeFromSelection: Ctrl+clique em célula, linha ou coluna já selecionada recorta o intervalo", () => {
  // Desmarcar a coluna B de A:D (r1:0..r2:10, c1:0..c2:3) divide em A:A e C:D
  assert.deepEqual(
    removeFromSelection([{ r1: 0, r2: 10, c1: 0, c2: 3 }], { mode: "col", c: 1, lastRow: 10 }),
    [
      { r1: 0, r2: 10, c1: 0, c2: 0 },
      { r1: 0, r2: 10, c1: 2, c2: 3 },
    ],
  );
  // Desmarcar a linha 3 de 2:5 (r1:1..r2:4, c1:0..c2:5) divide em 2:2 e 4:5
  assert.deepEqual(
    removeFromSelection([{ r1: 1, r2: 4, c1: 0, c2: 5 }], { mode: "row", r: 2, lastCol: 5 }),
    [
      { r1: 1, r2: 1, c1: 0, c2: 5 },
      { r1: 3, r2: 4, c1: 0, c2: 5 },
    ],
  );
  // Desmarcar o centro (2,2) de um bloco 3x3 (1..3 x 1..3) gera 4 sub-retângulos (topo, base, esquerda, direita)
  assert.deepEqual(
    removeFromSelection([{ r1: 1, r2: 3, c1: 1, c2: 3 }], { mode: "cell", r: 2, c: 2 }),
    [
      { r1: 1, r2: 1, c1: 1, c2: 3 },
      { r1: 3, r2: 3, c1: 1, c2: 3 },
      { r1: 2, r2: 2, c1: 1, c2: 1 },
      { r1: 2, r2: 2, c1: 3, c2: 3 },
    ],
  );
  // Nunca deixa a seleção inteira vazia (retorna null quando removeria a única célula selecionada)
  assert.equal(removeFromSelection([{ r1: 1, r2: 1, c1: 0, c2: 0 }], { mode: "cell", r: 1, c: 0 }), null);
});

test("extractStatNumber: soma e média em colunas numéricas, texto colado do Excel e fórmulas", () => {
  assert.deepEqual(extractStatNumber(ccol("NUMBER"), 150), { num: 150, currency: false });
  assert.deepEqual(extractStatNumber(ccol("CURRENCY"), 2500.5), { num: 2500.5, currency: true });
  assert.deepEqual(extractStatNumber(ccol("TEXT"), "R$ 1.500,50"), { num: 1500.5, currency: true });
  assert.deepEqual(extractStatNumber(ccol("TEXT"), "-R$ 250,00"), { num: -250, currency: true });
  assert.deepEqual(extractStatNumber(ccol("TEXT"), "1.234,56"), { num: 1234.56, currency: false });
  assert.deepEqual(extractStatNumber(ccol("TEXT"), "", { display: "R$ 3.000,00" }), { num: 3000, currency: true });
  assert.equal(extractStatNumber(ccol("CPF"), "52998224725"), null);
  assert.equal(extractStatNumber(ccol("PHONE"), "11999998888"), null);
  assert.equal(extractStatNumber(ccol("TEXT"), "10/11/2026"), null);
  assert.equal(extractStatNumber(ccol("TEXT"), "(11) 99999-9999"), null);
});

test("altura variável mantém offsets e encontra a linha certa na virtualização", () => {
  const offsets = buildRowOffsets(5, 41, (row) => (row === 2 ? 63 : 21));
  assert.deepEqual(offsets, [41, 41, 62, 125, 146, 167]);
  assert.equal(rowAtOffset(offsets, 41, 5), 1);
  assert.equal(rowAtOffset(offsets, 100, 5), 2);
  assert.equal(rowAtOffset(offsets, 125, 5), 3);
  assert.equal(rowAtOffset(offsets, 999, 5), 4);
});



// ─── Tabela sobre um intervalo + coluna sem título (Claude, 2026-10-29) ─────
import { resolveTableRange as resolveRangeT } from "../lib/sheets/formats.ts";
import { columnLabel as columnLabelT } from "../lib/sheets/format.ts";

test("tabela no intervalo: pontas por id, encolhe se uma ponta some, sem intervalo = planilha inteira", () => {
  const ids = ["a", "b", "c", "d"];
  assert.deepEqual(resolveRangeT(undefined, ids), { c1: 0, c2: 3, r1: 1, r2: Number.POSITIVE_INFINITY });
  assert.deepEqual(resolveRangeT({ c1: "b", c2: "c", r1: 3, r2: 8 }, ids), { c1: 1, c2: 2, r1: 3, r2: 8 });
  assert.deepEqual(resolveRangeT({ c1: "c", c2: "a", r1: 1, r2: null }, ids), { c1: 0, c2: 2, r1: 1, r2: Number.POSITIVE_INFINITY });
  assert.deepEqual(resolveRangeT({ c1: "x", c2: "c", r1: 1, r2: 4 }, ids), { c1: 2, c2: 2, r1: 1, r2: 4 });
  assert.equal(resolveRangeT({ c1: "x", c2: "y", r1: 1, r2: 4 }, ids), null);
});

test("coluna sem título aparece como 'Coluna C' só na exibição", () => {
  assert.equal(columnLabelT({ name: "" }, 2), "Coluna C");
  assert.equal(columnLabelT({ name: "  " }, 27), "Coluna AB");
  assert.equal(columnLabelT({ name: "Valor" }, 2), "Valor");
});
