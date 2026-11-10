import test from "node:test";
import assert from "node:assert/strict";
import { groupPdfItems } from "@/lib/ocr/extract-document-text";
import { cleanReadLines, isGoodEnough, looksUnreadable, summarizePass } from "@/lib/ocr/quality";
import { findFields } from "@/lib/ocr/find-fields";
import { flatFieldGray, toGray } from "@/lib/ocr/enhance";

test("limpa o lixo do OCR e mantém o que tem conteúdo", () => {
  const lines = cleanReadLines(["  NOME   JOSÉ  DA SILVA ", "", "~~ ;;", "|", "CPF 529.982.247-25", "a", "—— ,, ..  x"].map((text) => ({ text, confidence: 90 })));
  assert.deepEqual(lines.map((l) => l.text), ["NOME JOSÉ DA SILVA", "CPF 529.982.247-25"]);
});

test("junta os pedaços do PDF em linhas, de cima para baixo e da esquerda para a direita", () => {
  const item = (str: string, x: number, y: number) => ({ str, transform: [1, 0, 0, 1, x, y] });
  const lines = groupPdfItems([item("25", 120, 700), item("Nome:", 10, 700.5), item("Maria", 60, 700), item("CPF", 10, 650), item("", 5, 5), item("529", 60, 650)]);
  assert.deepEqual(lines, ["Nome: Maria 25", "CPF 529"]);
});

test("a nota da leitura premia texto confiável e acusa leitura ilegível", () => {
  const good = Array.from({ length: 12 }, (_, i) => ({ text: `palavra${i}`, confidence: 90 }));
  assert.equal(isGoodEnough(summarizePass(good)), true);
  const lixo = Array.from({ length: 12 }, () => ({ text: "x7", confidence: 30 }));
  assert.equal(looksUnreadable(summarizePass(lixo)), true);
  // pouca coisa lida com muita confiança não vence bastante texto bem lido
  assert.ok(summarizePass(good).score > summarizePass([{ text: "oi12", confidence: 99 }]).score);
});

test("CPF só aparece se a conta fechar; troca de letra por número é corrigida", () => {
  assert.deepEqual(findFields(["CPF 529.982.247-25"]).map((f) => [f.label, f.value]), [["CPF", "529.982.247-25"]]);
  // O no lugar de 0, S no lugar de 5 (5S9 → 559 não fecha; aqui "529.982.247-2S" fecha como ...25)
  assert.deepEqual(findFields(["CPF: 529.982.247-2S"]).map((f) => f.value), ["529.982.247-25"]);
  assert.deepEqual(findFields(["CPF 529.982.247-26"]), []); // dígito errado: nada é mostrado
  assert.deepEqual(findFields(["111.111.111-11"]), []);
  assert.deepEqual(findFields(["PALAVRASBOSS"]), []);
});

test("CNPJ com a conta certa é achado e não vira CPF", () => {
  const f = findFields(["CNPJ 11.222.333/0001-81"]);
  assert.deepEqual(f.map((x) => [x.label, x.value]), [["CNPJ", "11.222.333/0001-81"]]);
});

test("datas reais, com o rótulo do que são; datas impossíveis ficam de fora", () => {
  const f = findFields(["DATA NASCIMENTO", "12/03/1985", "VALIDADE 05/08/2030", "31/02/2020"]);
  assert.deepEqual(f.map((x) => [x.label, x.value]), [
    ["Data de nascimento", "12/03/1985"],
    ["Validade", "05/08/2030"],
  ]);
});

test("CEP e nome (palpite) são achados; nome da mãe não", () => {
  const f = findFields(["NOME", "MARIA APARECIDA DA SILVA", "FILIAÇÃO", "NOME DA MÃE JOANA SOUZA", "CEP 79002-000"]);
  assert.deepEqual(f.map((x) => [x.label, x.value]), [
    ["Nome (provável)", "MARIA APARECIDA DA SILVA"],
    ["CEP", "79002-000"],
  ]);
});

test("a correção de sombra deixa o papel uniforme e mantém as letras escuras", () => {
  const w = 300;
  const h = 200;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const shade = 255 - Math.round((x / w) * 110); // sombra que escurece da esquerda para a direita
      const ink = y % 40 < 4 && x % 30 < 20 && x > 20 && x < 280; // "linhas de texto"
      const v = ink ? Math.round(shade * 0.2) : shade;
      const i = (y * w + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  }
  const out = flatFieldGray(toGray(rgba), w, h);
  const paperLeft = out[(25 * w) + 5];
  const paperRight = out[(25 * w) + 295];
  assert.ok(paperLeft > 225 && paperRight > 225, `papel não ficou claro: ${paperLeft}/${paperRight}`);
  assert.ok(Math.abs(paperLeft - paperRight) < 20, "a sombra continua visível");
  const inkRight = out[(1 * w) + 270];
  assert.ok(inkRight < 90, `a letra ficou apagada: ${inkRight}`);
});

test("espaços e pontos soltos entre os grupos do CPF não atrapalham", () => {
  assert.deepEqual(findFields(["CPF 529.982 .247-25"]).map((f) => f.value), ["529.982.247-25"]);
  assert.deepEqual(findFields(["CPF 529. 982.247-25"]).map((f) => f.value), ["529.982.247-25"]);
});

test("sujeira curta de baixa confiança some; texto curto confiável fica", () => {
  const lines = cleanReadLines([
    { text: "— aii 1NM", confidence: 37 },
    { text: "CEP 79002-000", confidence: 38 },
    { text: "NOME", confidence: 96 },
  ]);
  assert.deepEqual(lines.map((l) => l.text), ["CEP 79002-000", "NOME"]);
});
