import test from "node:test";
import assert from "node:assert/strict";
import { findFields, missingFieldLabels, needsImageReading } from "@/lib/ocr/find-fields";
import { detectDocumentType } from "@/lib/ocr/document-type";
import type { ReadLine } from "@/lib/ocr/quality";

const at = (text: string, x0: number, y0: number, w = 400, h = 35, confidence = 90): ReadLine => ({ text, confidence, box: { x0, y0, x1: x0 + w, y1: y0 + h } });

// ---------------------------------------------------------------------------
// CNH digital (PDF): o texto do PDF é só cabeçalho/rodapé; o cartão é uma imagem.
// ---------------------------------------------------------------------------

const CNH_E_PDF_TEXT = [
  "REPÚBLICA FEDERATIVA DO BRASIL",
  "MINISTÉRIO DOS TRANSPORTES",
  "SECRETARIA NACIONAL DE TRÂNSITO - SENATRAN",
  "QR-CODE",
  "Documento assinado com certificado digital em conformidade",
  "com a Medida Provisória nº 2200-2/2001. Sua validade poderá",
  "ser confirmada por meio do programa Assinador Serpro.",
  "As orientações para instalar o Assinador Serpro e realizar a",
  "validação do documento digital estão disponíveis em:",
  "https://www.serpro.gov.br/assinador-digital.",
];

test("CNH digital: só o texto do rodapé é reconhecido como CNH, e a frase do rodapé NUNCA vira nome", () => {
  assert.equal(detectDocumentType(CNH_E_PDF_TEXT)?.id, "cnh");
  const fields = findFields(CNH_E_PDF_TEXT);
  assert.ok(!fields.some((f) => f.key === "name"), "não pode inventar nome a partir do rodapé");
  assert.ok(!fields.some((f) => f.key.startsWith("filiation")));
});

test("CNH digital: o texto do PDF sem o cartão pede a leitura da imagem e o que falta é avisado", () => {
  assert.equal(needsImageReading(CNH_E_PDF_TEXT), true);
  assert.deepEqual(missingFieldLabels(CNH_E_PDF_TEXT), ["Nome", "CPF", "Data de nascimento"]);
});

test("PDF de texto completo não pede leitura de imagem", () => {
  assert.equal(needsImageReading(["CARTEIRA NACIONAL DE HABILITAÇÃO", "NOME E SOBRENOME", "ANA PAULA RIBEIRO", "DATA NASCIMENTO 14/07/1988", "CPF 529.982.247-25"]), false);
  assert.equal(needsImageReading(["COMPROVANTE DE RESIDÊNCIA", "CEP 79002-100", "VENCIMENTO 10/11/2026"]), false);
  // documento que não se sabe qual é e não traz nome/CPF: a figura provavelmente traz
  assert.equal(needsImageReading(["Relatório mensal", "Página 1 de 3", "Total do período"]), true);
});

test("CRLV-e (também da SENATRAN) não é confundido com a CNH digital", () => {
  const crlv = ["MINISTÉRIO DOS TRANSPORTES", "SECRETARIA NACIONAL DE TRÂNSITO - SENATRAN", "CERTIFICADO DE REGISTRO E LICENCIAMENTO DE VEÍCULO ELETRÔNICO", "CÓDIGO RENAVAM 01234567890", "PLACA ABC1D23"];
  assert.equal(detectDocumentType(crlv)?.id, "vehicle");
  assert.ok(!findFields(crlv).some((f) => f.key === "name"));
});

test("CNH: campos numerados do cartão (2 e 1, 3, 4a, 4b, 4c, 4d, 5, 9) são lidos pelo rótulo", () => {
  const f = Object.fromEntries(
    findFields([
      "CARTEIRA NACIONAL DE HABILITAÇÃO / DRIVER LICENSE / PERMISO DE CONDUCCIÓN",
      "2 e 1 NOME E SOBRENOME",
      "VANESSA MEDEIROS DE OLIVEIRA",
      "1ª HABILITAÇÃO",
      "20/12/2012",
      "3 DATA, LOCAL E UF DE NASCIMENTO",
      "21/07/1994, CAMPO GRANDE, MS",
      "4a DATA EMISSÃO",
      "04/04/2023",
      "4b VALIDADE",
      "03/04/2033",
      "4c DOC. IDENTIDADE / ÓRG. EMISSOR / UF",
      "1912202 SEJUSP MS",
      "4d CPF",
      "049.507.131-59",
      "5 Nº REGISTRO",
      "05674774807",
      "9 CAT HAB",
      "AB",
    ]).map((x) => [x.key, x.value]),
  );
  assert.equal(f["name"], "VANESSA MEDEIROS DE OLIVEIRA");
  assert.equal(f["birth"], "21/07/1994");
  assert.equal(f["issue"], "04/04/2023", "a emissão desta via não pode ser a data da 1ª habilitação");
  assert.equal(f["first-license"], "20/12/2012");
  assert.equal(f["validity"], "03/04/2033");
  assert.equal(f["rg"], "1912202");
  assert.equal(f["issuer"], "SEJUSP/MS");
  assert.equal(f["cpf-04950713159"], "049.507.131-59");
  assert.equal(f["cnh-registry"], "05674774807");
  assert.equal(f["category"], "AB");
});

test("CNH sem os rótulos lidos: nome e filiação prováveis pela posição, sem cidade/UF ou 'Brasileiro' virar pessoa", () => {
  const lines = [
    at("CARTEIRA NACIONAL DE HABILITAÇÃO", 100, 40, 700, 20),
    // posições medidas na leitura de uma CNH digital real
    at("VANESSA MEDEIROS DE OLIVEIRA", 254, 287, 330, 16),
    at("20/12/2012", 1086, 287, 140, 18),
    at("CAMPO GRANDE, MS", 254, 560, 220, 16),
    at("BRASILEIRO", 628, 677, 150, 16),
    at("GENIVAL ALVES OLIVEIRA", 620, 754, 300, 16),
    at("VALKIRIA MEDEIROS REVELO", 619, 839, 320, 16),
    at("MATO GROSSO DO SUL", 400, 960, 260, 16),
  ];
  const byKey = Object.fromEntries(findFields(lines).map((f) => [f.key, f]));
  assert.equal(byKey["name"].value, "VANESSA MEDEIROS DE OLIVEIRA");
  assert.equal(byKey["filiation-0"].value, "GENIVAL ALVES OLIVEIRA");
  assert.equal(byKey["filiation-1"].value, "VALKIRIA MEDEIROS REVELO");
  assert.ok(!Object.values(byKey).some((f) => /CAMPO GRANDE|MATO GROSSO/.test(f.value)));
});

test("CNH: rótulo mal lido (confiança baixa) entre o nome e a filiação não vira filiação", () => {
  const lines = [
    at("CARTEIRA NACIONAL DE HABILITAÇÃO", 100, 40, 700, 20),
    at("VANESSA MEDEIROS DE OLIVEIRA", 254, 287, 330, 16),
    at("ENTICADE ÔRG EM EM SSOR", 705, 493, 200, 11, 70),
    at("GENIVAL ALVES OLIVEIRA", 620, 754, 300, 16),
    at("VALKIRIA MEDEIROS REVELO", 619, 839, 320, 16),
  ];
  const byKey = Object.fromEntries(findFields(lines).map((f) => [f.key, f]));
  assert.equal(byKey["filiation-0"].value, "GENIVAL ALVES OLIVEIRA");
  assert.equal(byKey["filiation-1"].value, "VALKIRIA MEDEIROS REVELO");
});

test("CNH com o rótulo FILIAÇÃO lido: os dois nomes saem, mesmo com linha em branco entre eles", () => {
  const lines = [
    at("CARTEIRA NACIONAL DE HABILITAÇÃO", 100, 40, 700, 20),
    at("FILIAÇÃO", 619, 720, 90, 11),
    at("GENIVAL ALVES OLIVEIRA", 620, 754, 300, 16),
    at("VALKIRIA MEDEIROS REVELO", 619, 839, 320, 16),
  ];
  const f = Object.fromEntries(findFields(lines).map((x) => [x.key, x]));
  assert.equal(f["filiation-0"].value, "GENIVAL ALVES OLIVEIRA");
  assert.equal(f["filiation-1"].value, "VALKIRIA MEDEIROS REVELO");
  assert.equal(f["filiation-1"].label, "Filiação");
});

test("a data da 1ª habilitação não aparece também como 'Data' solta", () => {
  const f = findFields(["CARTEIRA NACIONAL DE HABILITAÇÃO", "1º HABILITAÇÃO", "20/12/2012", "4a DATA EMISSÃO", "04/04/2023"]);
  assert.equal(f.filter((x) => x.value === "20/12/2012").length, 1);
  assert.equal(f.find((x) => x.value === "20/12/2012")?.label, "1ª habilitação");
});

test("palpite de nome ignora frases em minúsculas (rodapés, avisos) mesmo com 3+ palavras", () => {
  const f = findFields(["ser confirmada por meio do programa Assinador Serpro.", "Abrir em outra aba", "Texto do documento"]);
  assert.ok(!f.some((x) => x.key === "name"));
});
