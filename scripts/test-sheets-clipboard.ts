/**
 * Copiar/colar com formatação (HTML do Excel e do Google Sheets) — precisa
 * de um DOM; o caminho do jsdom vem por variável de ambiente para não virar
 * dependência do projeto:
 *
 *   JSDOM_PATH=<pasta>/node_modules/jsdom node --experimental-transform-types --import ./scripts/alias-loader.mjs --test scripts/test-sheets-clipboard.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
type JsdomModule = { JSDOM: new (html: string) => { window: { DOMParser: unknown; document: unknown } } };
const { JSDOM } = require(process.env.JSDOM_PATH ?? "jsdom") as JsdomModule;
const dom = new JSDOM("");
Object.assign(globalThis, { DOMParser: dom.window.DOMParser, document: dom.window.document });

const { parseClipboardHtml, buildClipboardHtml, normalizeColor } = await import("../lib/sheets/clipboard-html.ts");

// HTML no formato que o Excel (Windows) realmente coloca na área de transferência.
const EXCEL_HTML = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head>
<style><!--table {mso-displayed-decimal-separator:"\\,";}
.xl65 {mso-style-parent:style0; font-weight:700; text-align:center; background:#FFFF00; mso-pattern:black none;}
.xl66 {mso-style-parent:style0; color:red; font-style:italic;}
.xl67 {mso-style-parent:style0; text-decoration:underline; text-underline-style:single; mso-number-format:"\\0022R$\\0022\\\\ \\#\\,\\#\\#0\\.00";}
.xl68 {mso-style-parent:style0; background:#C6EFCE; mso-pattern:black none; color:#006100;}
--></style></head><body>
<table border=0 cellpadding=0 cellspacing=0 width=192>
<tr height=20><td class=xl65 height=20 width=64>Nome</td><td class=xl65 width=64>Valor</td><td class=xl65 width=64>Status</td></tr>
<tr height=20><td class=xl66>Ana</td><td class=xl67 align=right>R$ 1.500,00</td><td class=xl68>Pago</td></tr>
<tr height=20><td>Bruno</td><td align=right>300</td><td style="text-decoration:line-through">Cancelado</td></tr>
</table></body></html>`;

// Google Sheets: estilo inline e tags.
const SHEETS_HTML = `<meta charset="utf-8"><google-sheets-html-origin><table><tbody>
<tr><td style="background-color:#d9ead3;font-weight:bold;">Total</td><td style="color:rgb(255,0,0);text-align:right;"><b>42</b></td></tr>
<tr><td colspan="2"><i>mesclada</i></td></tr></tbody></table>`;

const BORDER_HTML = `<html><head><style>
.xl70 { border:.5pt solid windowtext; }
.xl71 { border-top:none; border-right:2px dashed #107C41; border-bottom:3px double red; border-left:1px dotted black; }
</style></head><body><table><tr><td class="xl70">Todas</td><td class="xl71">Mistas</td></tr></table></body></html>`;

test("cores CSS viram #RRGGBB (preto/automático e transparente somem)", () => {
  assert.equal(normalizeColor("#ff0"), "#FFFF00");
  assert.equal(normalizeColor("rgb(255, 0, 0)"), "#FF0000");
  assert.equal(normalizeColor("rgba(0,0,0,0)"), undefined);
  assert.equal(normalizeColor("windowtext"), undefined);
  assert.equal(normalizeColor("transparent"), undefined);
});

test("colar do Excel: texto + negrito, itálico, sublinhado, tachado, cores, preenchimento, alinhamento", () => {
  const grid = parseClipboardHtml(EXCEL_HTML)!;
  assert.equal(grid.length, 3);
  assert.deepEqual(grid[0].map((c) => c.text), ["Nome", "Valor", "Status"]);
  assert.deepEqual(grid[0][0].format, { b: true, fill: "#FFFF00", align: "center" });
  assert.equal(grid[1][0].text, "Ana");
  assert.equal(grid[1][0].format?.i, true);
  assert.ok(grid[1][0].format?.color, "vermelho do Excel ('red') vira cor");
  assert.equal(grid[1][1].text, "R$ 1.500,00");
  assert.deepEqual(grid[1][1].format, { u: true, align: "right" });
  assert.deepEqual(grid[1][2].format, { fill: "#C6EFCE", color: "#006100" }); // estilo "Bom" do Excel
  assert.equal(grid[2][0].format, undefined); // célula sem estilo = sem marcação
  assert.deepEqual(grid[2][2].format, { s: true });
});

test("colar do Google Sheets: estilo inline, <b>, <i> e célula mesclada", () => {
  const grid = parseClipboardHtml(SHEETS_HTML)!;
  assert.deepEqual(grid[0][0].format, { b: true, fill: "#D9EAD3" });
  assert.deepEqual(grid[0][1], { text: "42", format: { b: true, color: "#FF0000", align: "right" } });
  assert.equal(grid[1][0].text, "mesclada");
  assert.equal(grid[1][0].format?.i, true);
  assert.equal(grid[1][1].text, ""); // mesclada vira vazia ao lado, como o Excel cola
});

test("HTML que não é tabela: usa o texto puro", () => {
  assert.equal(parseClipboardHtml("<p>oi</p>"), null);
});

test("bordas do HTML do Excel entram por lado, espessura, traço e cor", () => {
  const grid = parseClipboardHtml(BORDER_HTML)!;
  assert.deepEqual(grid[0][0].format, {
    borderTop: { style: "thin" }, borderRight: { style: "thin" }, borderBottom: { style: "thin" }, borderLeft: { style: "thin" },
  });
  assert.deepEqual(grid[0][1].format, {
    borderRight: { style: "mediumDashed", color: "#107C41" },
    borderBottom: { style: "double", color: "#FF0000" },
    borderLeft: { style: "dotted", color: "#000000" },
  });
});

test("copiar daqui: HTML com estilo inline que o Excel entende — e volta igual", () => {
  const html = buildClipboardHtml([
    [{ text: "Nome", format: { b: true } }, { text: "Valor" }],
    [{ text: "Ana <x>", format: { fill: "#FFFF00", color: "#C00000", i: true, align: "center", borderBottom: { style: "thick", color: "#107C41" } } }, { text: "1,5" }],
  ]);
  assert.match(html, /font-weight:700/);
  assert.match(html, /background:#FFFF00/);
  assert.match(html, /Ana &lt;x&gt;/);
  assert.match(html, /border-bottom:3px solid #107C41/);
  const back = parseClipboardHtml(html)!;
  assert.deepEqual(back[0][0].format, { b: true });
  assert.deepEqual(back[1][0], { text: "Ana <x>", format: { i: true, fill: "#FFFF00", color: "#C00000", align: "center", borderBottom: { style: "thick", color: "#107C41" } } });
  assert.equal(back[1][1].text, "1,5");
});
