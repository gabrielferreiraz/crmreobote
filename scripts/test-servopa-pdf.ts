/**
 * PDF da tabela Servopa (folha A4) — organização do texto de regras e contratos
 * da folha:
 *
 *   node --experimental-strip-types --test scripts/test-servopa-pdf.ts
 *
 * Os textos abaixo são cópias reais publicadas pela Servopa (grupos 1511, 1570
 * e um dos grupos com "NESTA MODALIDADE" dentro da lista).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contemplationWords, splitContemplationText } from "../lib/servopa-tables/contemplation.ts";
import { servopaPdfFileName } from "../lib/servopa-tables/export-pdf.ts";

const words = (text: string) => text.split(/\s+/).filter((word) => word && word !== "-");

const GROUP_1511 = `- ORDEM DE CONTEMPLACAO:
1) SORTEIO
2) LANCE LIVRE
3) LANCE FIXO DE 30%
- O LANCE PODERA SER DILUIDO.
- O SEGURO PRESTAMISTA E OPCIONAL.
- O CONSORCIADO CONTEMPLADO PODERA ALTERAR O VALOR DO
CREDITO PARA ATE 3 CATEGORIAS ACIMA DA ADQUIRIDA.
- O REAJUSTE DO CREDITO SERA PELO INCC (INDICE
NACIONAL DE CUSTO DA CONSTRUCAO) ANUALMENTE.`;

// Títulos sem dois-pontos e o erro de digitação "PARTOR" vêm assim do site.
const GROUP_1570 = `- ORDEM DE CONTEMPLACAO ATE A 6ª ASSEMBLEIA
SORTEIO; NUMERO DE CONTEMPLACOES CONFORME SALDO
- ORDEM DE CONTEMPLACAO A PARTOR DA 37ª ASSEMBLEIA
SORTEIO
SORTEIO
LANCE FIDELIDADE DE 15%
- NA MODALIDADE LANCE FIDELIDADE DE 15% (FIXO) PODERA
SER UTILIZADO O EMBUTIDO E ESTAO APTOS A CONCORRER
A ASSEMBLEIA EM QUESTAO.
- O SEGURO PRESTAMISTA E OBRIGATORIO NA CONTEMPLACAO
- REAJUSTE PELO INCC (INDICE NACIONAL DE CUSTO DA
CONSTRUCAO) SEMESTRALMENTE.`;

const SENTENCE_INSIDE_LIST = `- ORDEM DAS CONTEMPLAÇÕES:
SORTEIO;
LANCE FIDELIDADE 15% FIXO;
NESTA MODALIDADE, ESTÃO APTOS A CONCORRER OS
CONSORCIADOS QUE TENHAM NO MINÍMO 12 (DOZE)
MENSALIDADES PAGAS EM DIA DE FORMA CONSECUTIVA.
LANCE LIVRE.`;

test("regras: listas viram itens e frases quebradas pelo site viram uma frase só", () => {
  assert.deepEqual(splitContemplationText(GROUP_1511), [
    { kind: "list", title: "ORDEM DE CONTEMPLACAO:", items: ["1) SORTEIO", "2) LANCE LIVRE", "3) LANCE FIXO DE 30%"] },
    { kind: "note", text: "O LANCE PODERA SER DILUIDO." },
    { kind: "note", text: "O SEGURO PRESTAMISTA E OPCIONAL." },
    { kind: "note", text: "O CONSORCIADO CONTEMPLADO PODERA ALTERAR O VALOR DO CREDITO PARA ATE 3 CATEGORIAS ACIMA DA ADQUIRIDA." },
    { kind: "note", text: "O REAJUSTE DO CREDITO SERA PELO INCC (INDICE NACIONAL DE CUSTO DA CONSTRUCAO) ANUALMENTE." },
  ]);
});

test("regras: 'ORDEM DE CONTEMPLACAO' sem dois-pontos continua sendo lista (grupos 1567, 1568, 1570, 1571)", () => {
  const blocks = splitContemplationText(GROUP_1570);
  assert.deepEqual(blocks[0], { kind: "list", title: "ORDEM DE CONTEMPLACAO ATE A 6ª ASSEMBLEIA", items: ["SORTEIO; NUMERO DE CONTEMPLACOES CONFORME SALDO"] });
  assert.deepEqual(blocks[1], { kind: "list", title: "ORDEM DE CONTEMPLACAO A PARTOR DA 37ª ASSEMBLEIA", items: ["SORTEIO", "SORTEIO", "LANCE FIDELIDADE DE 15%"] });
  assert.equal(blocks[2].kind, "note");
  assert.equal(blocks.length, 5);
});

test("regras: frase longa dentro da lista fica inteira, itens curtos continuam separados", () => {
  const [block] = splitContemplationText(SENTENCE_INSIDE_LIST);
  assert.deepEqual(block, {
    kind: "list",
    title: "ORDEM DAS CONTEMPLAÇÕES:",
    items: [
      "SORTEIO;",
      "LANCE FIDELIDADE 15% FIXO;",
      "NESTA MODALIDADE, ESTÃO APTOS A CONCORRER OS CONSORCIADOS QUE TENHAM NO MINÍMO 12 (DOZE) MENSALIDADES PAGAS EM DIA DE FORMA CONSECUTIVA.",
      "LANCE LIVRE.",
    ],
  });
});

test("regras: nenhuma palavra do site é perdida, trocada ou inventada", () => {
  for (const text of [GROUP_1511, GROUP_1570, SENTENCE_INSIDE_LIST, "texto sem traço\ncontinua", ""]) {
    assert.deepEqual(contemplationWords(splitContemplationText(text)), words(text));
  }
});

test("nome do arquivo baixado: título da tabela sem acentos nem caracteres proibidos", () => {
  assert.equal(servopaPdfFileName("GRUPO 1568 - 120 MESES - ADM 13%"), "GRUPO 1568 - 120 MESES - ADM 13%.pdf");
  assert.equal(servopaPdfFileName("GRUPO 1511 - 12 MESES - ADM 9,9%"), "GRUPO 1511 - 12 MESES - ADM 9,9%.pdf");
  assert.equal(servopaPdfFileName('Tabela: "ação"/teste'), "Tabela acaoteste.pdf");
  assert.equal(servopaPdfFileName("   "), "Tabela Servopa.pdf");
});

test("folha: uma página A4 sem cabeçalho/rodapé do navegador, letra que se ajusta e Parceira Autorizada", () => {
  const sheet = readFileSync("components/servopa-tables/print-sheet.tsx", "utf8");
  assert.match(sheet, /@page \{ size: A4; margin: 0; \}/, "margem 0: o navegador não imprime data/endereço");
  assert.match(sheet, /\.servopa-sheet \{ width: 210mm; height: 297mm; overflow: hidden;/);
  assert.match(readFileSync("components/servopa-tables/sheet-header.tsx", "utf8"), /Parceira Autorizada/);
  assert.match(sheet, /<SheetTitle groupNumber=\{table\.groupNumber\}/);
  assert.match(sheet, /formatPercent\(table\.admEffective/, "o cliente vê só a taxa efetiva");
  assert.doesNotMatch(sheet, /admOriginal/, "a taxa original da Servopa nunca vai para o PDF");
  assert.match(sheet, /whitespace-nowrap[^"]*tabular-nums/, "valores não quebram (R$ separado do número)");
  const fit = readFileSync("components/servopa-tables/sheet-fit.tsx", "utf8");
  assert.match(fit, /RULES_MAX_PX = 11/);
  assert.match(fit, /RULES_MIN_PX = 6\.5/);
  assert.match(fit, /dataset\.compact = compact/);
  const exporter = readFileSync("lib/servopa-tables/export-pdf.ts", "utf8");
  assert.match(exporter, /removeProperty\("--servopa-preview-zoom"\)/, "zoom do celular não vai para o arquivo");
  assert.match(exporter, /format: "a4"/);
});

// Impressora de verdade (EPSON, 27/10/2026): margens físicas + escala lembrada cortavam a coluna Seguro e davam 2 folhas.
test("imprimir: o botão imprime o mesmo PDF do download e o Ctrl+P nunca trava a largura em 210 mm", () => {
  const button = readFileSync("app/tabela-servopa/[id]/print-button.tsx", "utf8");
  assert.match(button, /printServopaTablePdf\(\)/);
  assert.doesNotMatch(button, /onClick=\{\(\) => window\.print\(\)\}/, "o botão não imprime mais o HTML direto");
  const exporter = readFileSync("lib/servopa-tables/export-pdf.ts", "utf8");
  assert.match(exporter, /export async function printServopaTablePdf/);
  assert.match(exporter, /const viewer = frame\.contentWindow;[\s\S]*viewer\.print\(\)/);
  assert.match(exporter, /window\.open\(url, "_blank"\)/, "sem visualizador embutido, abre o PDF numa aba");
  const sheet = readFileSync("components/servopa-tables/print-sheet.tsx", "utf8");
  const printCss = sheet.slice(sheet.indexOf("@media print"), sheet.indexOf("</style>"));
  assert.match(printCss, /(?<![-\w])width: 100% !important/);
  // max-width (teto) pode; largura ou largura mínima fixa, não.
  assert.doesNotMatch(printCss, /(?<![-\w])(?:min-)?width: 210mm !important/, "largura fixa corta a folha em impressora com margem");
  assert.doesNotMatch(printCss, /overflow: hidden !important/, "na impressão nada pode ser escondido");
});

// A escala do diálogo de impressão é "grudenta" no Chrome/Edge (também para PDF) e nenhuma página consegue mudá-la.
test("imprimir: guia da escala antes da 1ª impressão, link de ajuda e plano B para cada falha", () => {
  const button = readFileSync("app/tabela-servopa/[id]/print-button.tsx", "utf8");
  assert.match(button, /Ajustar à área de impressão/);
  assert.match(button, /GUIDE_SEEN_KEY = "servopa-print-guide-ok"/);
  assert.match(button, /try \{\s*return window\.localStorage\.getItem/, "localStorage bloqueado não pode quebrar o botão");
  assert.match(button, /Saiu cortado ou grande demais/);
  assert.match(button, /error\.code === "POPUP_BLOCKED"/);
  assert.match(button, /window\.print\(\);/, "último recurso: imprimir a página");
  const exporter = readFileSync("lib/servopa-tables/export-pdf.ts", "utf8");
  assert.match(exporter, /throw new ServopaPdfError\("POPUP_BLOCKED"\)/);
  assert.match(exporter, /getElementById\(PRINT_FRAME_ID\)\?\.remove\(\)/, "cliques repetidos não acumulam quadros");
  assert.doesNotMatch(exporter, /window\.location\.href = url/, "nunca troca a página do usuário pelo PDF");
});
